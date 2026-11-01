package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/require"
)

func sampleEncryptedMessage() map[string]interface{} {
	enc := func(n int) string { return base64.StdEncoding.EncodeToString(make([]byte, n)) }
	return map[string]interface{}{"version": 1, "signature": enc(64), "iv": enc(16), "pubECDHE": enc(65), "encryptedData": enc(10), "encryptedKey": [][2]string{{enc(32), enc(24)}}}
}

func TestEncryptedEdits(t *testing.T) {
	for _, channelState := range []string{"0", "1"} {
		t.Run(channelState, func(t *testing.T) {
			api := &plugintest.API{}
			api.On("KVGet", ChanEncryptionMethodKey("channel")).Return([]byte(channelState), nil)
			p := &Plugin{}
			p.SetAPI(api)
			old := &model.Post{ChannelId: "channel", Type: "custom_e2ee"}
			edited := &model.Post{ChannelId: "channel", Type: "custom_e2ee", Message: "plaintext edit"}
			edited.AddProp("e2ee", sampleEncryptedMessage())
			_, reason := p.MessageWillBeUpdated(nil, edited, old)
			require.NotEmpty(t, reason)
			edited.Message = "Encrypted message 1234"
			accepted, reason := p.MessageWillBeUpdated(nil, edited, old)
			require.Empty(t, reason)
			require.Same(t, edited, accepted)
			edited.Type = ""
			_, reason = p.MessageWillBeUpdated(nil, edited, old)
			require.NotEmpty(t, reason)
		})
	}
}

func TestEncryptedUploadGuard(t *testing.T) {
	api := &plugintest.API{}
	api.On("KVGet", ChanEncryptionMethodKey("channel")).Return([]byte("1"), nil)
	p := &Plugin{}
	p.SetAPI(api)
	info := &model.FileInfo{Id: "file", ChannelId: "channel", CreatorId: "sender", Name: "secret.pdf"}
	_, reason := p.FileWillBeUploaded(nil, info, bytes.NewBufferString("secret"), io.Discard)
	require.NotEmpty(t, reason)
	info.Name = encryptedAttachmentName
	_, reason = p.FileWillBeUploaded(nil, info, bytes.NewBufferString("secret"), io.Discard)
	require.NotEmpty(t, reason)
	envelope := map[string]interface{}{"format": "mattermost-e2ee-file-v1", "sender_id": "sender", "message": sampleEncryptedMessage()}
	data, err := json.Marshal(envelope)
	require.NoError(t, err)
	api.On("KVSet", "encryptedFile:file", []byte("1")).Return(nil).Once()
	_, reason = p.FileWillBeUploaded(nil, info, bytes.NewReader(append([]byte("MME2EE\x00"), data...)), io.Discard)
	require.Empty(t, reason)
	envelope["sender_id"] = "other"
	data, err = json.Marshal(envelope)
	require.NoError(t, err)
	_, reason = p.FileWillBeUploaded(nil, info, bytes.NewReader(append([]byte("MME2EE\x00"), data...)), io.Discard)
	require.NotEmpty(t, reason)
	api.AssertExpectations(t)
}

func TestEncryptionLookupFailsClosed(t *testing.T) {
	api := &plugintest.API{}
	api.On("KVGet", ChanEncryptionMethodKey("channel")).Return(nil, &model.AppError{Message: "unavailable"})
	p := &Plugin{}
	p.SetAPI(api)
	_, reason := p.FileWillBeUploaded(nil, &model.FileInfo{ChannelId: "channel", Name: "secret"}, bytes.NewReader(nil), io.Discard)
	require.NotEmpty(t, reason)
	_, reason = p.MessageWillBeUpdated(nil, &model.Post{}, &model.Post{ChannelId: "channel", Type: "custom_e2ee"})
	require.NotEmpty(t, reason)
}

func TestPlaintextAttachmentCannotBeReused(t *testing.T) {
	api := &plugintest.API{}
	api.On("GetFileInfo", "file").Return(&model.FileInfo{Name: encryptedAttachmentName}, nil)
	api.On("KVGet", "encryptedFile:file").Return(nil, nil)
	p := &Plugin{}
	p.SetAPI(api)
	require.NotEmpty(t, p.validateEncryptedAttachments(&model.Post{FileIds: []string{"file"}}))
}
