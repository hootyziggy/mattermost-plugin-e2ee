package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) MessageWillBePosted(c *plugin.Context, post *model.Post) (*model.Post, string) {
	// Bypass for our bot
	if post.UserId == p.BotUserID {
		return nil, ""
	}

	// Nothing to further check if we are not encrypting that channel
	required, err := p.channelEncryptionRequired(post.ChannelId)
	if err != nil {
		return nil, "Unable to check channel encryption status."
	}
	if !required {
		return nil, ""
	}

	// If configured to do so, bypass for all bots
	if p.getConfiguration().BotCanAlwaysPost {
		user, appErr := p.API.GetUser(post.UserId)
		if appErr != nil {
			return nil, fmt.Sprintf("unable to check if user is a bot: %s", appErr.Error())
		}
		if user.IsBot {
			return nil, ""
		}
	}

	// Check if the type of the message is whitelisted
	if _, has := p.AlwaysAllowMsgTypes[post.Type]; has {
		return nil, ""
	}

	// If the message is not encrypted, rejects it!
	if !validEncryptedPost(post) {
		return nil, "Unencrypted messages can't be sent on an encrypted channel."
	}

	if reason := p.validateEncryptedAttachments(post); reason != "" {
		return nil, reason
	}
	return nil, ""
}

// MessageWillBeUpdated rejects plaintext edits, including after encryption has
// been disabled for a channel containing previously encrypted messages.
func (p *Plugin) MessageWillBeUpdated(c *plugin.Context, post, oldPost *model.Post) (*model.Post, string) {
	required, err := p.channelEncryptionRequired(oldPost.ChannelId)
	if err != nil {
		return nil, "Unable to check channel encryption status."
	}
	if oldPost.Type == "custom_e2ee" || required {
		if !validEncryptedPost(post) {
			return nil, "Use Edit encrypted message to edit this post. Plaintext edits are not allowed."
		}
		if reason := p.validateEncryptedAttachments(post); reason != "" {
			return nil, reason
		}
	}
	return post, ""
}

func validEncryptedPost(post *model.Post) bool {
	if post.Type != "custom_e2ee" || !encryptedPlaceholder(post.Message) {
		return false
	}
	data, err := json.Marshal(post.GetProp("e2ee"))
	if err != nil {
		return false
	}
	var message encryptedMessage
	return json.Unmarshal(data, &message) == nil && message.valid()
}

func encryptedPlaceholder(message string) bool {
	if message == "Encrypted message" {
		return true
	}
	if !strings.HasPrefix(message, "Encrypted message ") {
		return false
	}
	suffix := strings.TrimPrefix(message, "Encrypted message ")
	if len(suffix) == 0 || len(suffix) > 20 {
		return false
	}
	for _, ch := range suffix {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func (p *Plugin) validateEncryptedAttachments(post *model.Post) string {
	for _, id := range post.FileIds {
		info, err := p.API.GetFileInfo(id)
		marker, markerErr := p.API.KVGet("encryptedFile:" + id)
		if err != nil || markerErr != nil || !bytes.Equal(marker, []byte("1")) || info == nil || info.Name != encryptedAttachmentName {
			return "Only encrypted attachments can be attached to encrypted messages. Upload the file again with E2EE enabled."
		}
	}
	return ""
}

const encryptedAttachmentName = "encrypted.e2ee"

type encryptedMessage struct {
	Version       int         `json:"version"`
	Signature     string      `json:"signature"`
	EncryptedData string      `json:"encryptedData"`
	IV            string      `json:"iv"`
	PubECDHE      string      `json:"pubECDHE"`
	EncryptedKeys [][2]string `json:"encryptedKey"`
}

func (m encryptedMessage) valid() bool {
	signature, e1 := base64.StdEncoding.DecodeString(m.Signature)
	iv, e2 := base64.StdEncoding.DecodeString(m.IV)
	pub, e3 := base64.StdEncoding.DecodeString(m.PubECDHE)
	_, e4 := base64.StdEncoding.DecodeString(m.EncryptedData)
	if m.Version != 1 || e1 != nil || e2 != nil || e3 != nil || e4 != nil || len(signature) != 64 || len(iv) != 16 || len(pub) != 65 || len(m.EncryptedKeys) == 0 {
		return false
	}
	for _, pair := range m.EncryptedKeys {
		id, idErr := base64.StdEncoding.DecodeString(pair[0])
		key, keyErr := base64.StdEncoding.DecodeString(pair[1])
		if idErr != nil || keyErr != nil || len(id) != 32 || len(key) != 24 {
			return false
		}
	}
	return true
}

func (p *Plugin) channelEncryptionRequired(channelID string) (bool, error) {
	data, appErr := p.API.KVGet(ChanEncryptionMethodKey(channelID))
	if appErr != nil {
		return false, appErr
	}
	if data == nil {
		return false, nil
	}
	var method ChanEncryptionMethod
	if err := json.Unmarshal(data, &method); err != nil {
		return false, err
	}
	if method != ChanEncryptionMethodNone && method != ChanEncryptionMethodP2P {
		return false, fmt.Errorf("unknown encryption method")
	}
	return method != ChanEncryptionMethodNone, nil
}

// FileWillBeUploaded sees ciphertext only. It prevents accidental plaintext
// uploads by clients without the browser-side encryption hook.
func (p *Plugin) FileWillBeUploaded(c *plugin.Context, info *model.FileInfo, file io.Reader, output io.Writer) (*model.FileInfo, string) {
	required, err := p.channelEncryptionRequired(info.ChannelId)
	if err != nil {
		return nil, "Unable to check channel encryption status."
	}
	if info.Name != encryptedAttachmentName {
		if required {
			return nil, "Encrypt attachments with the E2EE web plugin before uploading."
		}
		return nil, ""
	}
	magic := make([]byte, 7)
	if _, err := io.ReadFull(file, magic); err != nil || string(magic) != "MME2EE\x00" {
		return nil, "Invalid encrypted attachment."
	}
	var envelope struct {
		Format   string           `json:"format"`
		SenderID string           `json:"sender_id"`
		Message  encryptedMessage `json:"message"`
	}
	decoder := json.NewDecoder(io.LimitReader(file, 30*1024*1024))
	if err := decoder.Decode(&envelope); err != nil || envelope.Format != "mattermost-e2ee-file-v1" || envelope.SenderID != info.CreatorId || !envelope.Message.valid() {
		return nil, "Invalid encrypted attachment."
	}
	var extra interface{}
	if decoder.Decode(&extra) != io.EOF {
		return nil, "Invalid encrypted attachment."
	}
	if appErr := p.API.KVSet("encryptedFile:"+info.Id, []byte("1")); appErr != nil {
		return nil, "Unable to record encrypted attachment."
	}
	return nil, ""
}
