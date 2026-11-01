package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/json"
	"math/big"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
)

func SerializePubKey(x *big.Int, y *big.Int) []byte {
	CL := ECCurve.Params().BitSize / 8
	xb := make([]byte, CL)
	x.FillBytes(xb)
	yb := make([]byte, CL)
	y.FillBytes(yb)
	ret := bytes.Buffer{}
	ret.WriteByte(0x04) // uncompressed point
	ret.Write(xb)
	ret.Write(yb)
	return ret.Bytes()
}

func GenerateValidPubKey() PubKey {
	key0, _ := ecdsa.GenerateKey(ECCurve, rand.Reader)
	key1, _ := ecdsa.GenerateKey(ECCurve, rand.Reader)
	return PubKey{
		SerializePubKey(key0.X, key0.Y),
		SerializePubKey(key1.X, key1.Y),
	}
}

func Test_pubkey_setget(t *testing.T) {
	mockAPI := plugintest.API{}
	p := Plugin{}
	p.SetAPI(&mockAPI)
	p.InitializeAPI()
	tassert := assert.New(t)

	user := "user1"
	pubkey := GenerateValidPubKey()
	pubkeyJSON, _ := json.Marshal(pubkey)

	mockAPI.On("KVSet", StoreKeyPubKey(user), pubkeyJSON).Return(nil)
	err := p.SetUserPubKey(user, &pubkey)
	tassert.Nil(err)

	mockAPI.On("KVGet", StoreKeyPubKey(user)).Return(pubkeyJSON, nil)
	gotkey, err := p.GetUserPubKey(user)
	tassert.Nil(err)
	tassert.Equal(*gotkey, pubkey)
}

func Test_pubkey_has(t *testing.T) {
	mockAPI := plugintest.API{}
	p := Plugin{}
	p.SetAPI(&mockAPI)
	p.InitializeAPI()
	tassert := assert.New(t)

	user := "user1"
	mockAPI.On("KVGet", StoreKeyPubKey(user)).Return([]byte(""), nil)
	hasKey, err := p.HasUserPubKey(user)
	tassert.Equal(true, hasKey)
	tassert.Nil(err)

	user = "user2"
	mockAPI.On("KVGet", StoreKeyPubKey(user)).Return(nil, nil)
	hasKey, err = p.HasUserPubKey(user)
	tassert.Equal(false, hasKey)
	tassert.Nil(err)
}

func Test_pubkey_validate(t *testing.T) {
	pubkey := GenerateValidPubKey()
	assert.Equal(t, pubkey.Validate(), true)
}

func Test_pubkey_badkey(t *testing.T) {
	tassert := assert.New(t)
	pubkey := GenerateValidPubKey()
	tassert.Equal(true, pubkey.Validate())

	pubkey.Encr[0] = 0
	tassert.Equal(false, pubkey.Validate())
	pubkey.Encr[0] = 4

	tassert.Equal(true, pubkey.Validate())
	pubkey.Encr[1] ^= 1
	tassert.Equal(false, pubkey.Validate())
	pubkey.Encr[1] ^= 1

	tassert.Equal(true, pubkey.Validate())
	pubkey.Sign[1] ^= 1
	tassert.Equal(false, pubkey.Validate())
	pubkey.Sign[1] ^= 1

	tassert.Equal(true, pubkey.Validate())
	pubkey.Encr = pubkey.Sign
	tassert.Equal(false, pubkey.Validate())
}

func Test_pubkey_channelsMembersWithoutKeys(t *testing.T) {
	mockAPI := plugintest.API{}
	p := Plugin{}
	p.SetAPI(&mockAPI)
	p.InitializeAPI()
	tassert := assert.New(t)

	chanID := "chan1"

	maxUsersPerTeam := 10
	mockAPI.On("GetConfig").Return(&model.Config{
		TeamSettings: model.TeamSettings{
			MaxUsersPerTeam: &maxUsersPerTeam,
		},
	})

	mockAPI.On("GetChannelMembers", chanID, 0, maxUsersPerTeam).Return(model.ChannelMembers{
		{
			UserId: "user1",
		},
		{
			UserId: "user2",
		},
	}, nil)

	mockAPI.On("GetUser", "user1").Return(&model.User{DeleteAt: 0}, nil)
	mockAPI.On("GetUser", "user2").Return(&model.User{DeleteAt: 0}, nil)

	mockAPI.On("KVGet", StoreKeyPubKey("user1")).Return([]byte(""), nil)
	mockAPI.On("KVGet", StoreKeyPubKey("user2")).Return(nil, nil)

	uids, err := p.GetChannelMembersWithoutKeys(chanID)
	tassert.Nil(err)
	tassert.Equal([]string{"user2"}, uids)
}
