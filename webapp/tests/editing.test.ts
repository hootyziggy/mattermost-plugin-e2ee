import {Client4} from 'mattermost-redux/client';

import {PrivateKeyMaterial} from '../src/e2ee';
import {editEncryptedPost} from '../src/editing';
import {decryptPost} from '../src/e2ee_post';

afterEach(() => jest.restoreAllMocks());

test('edits send ciphertext and preserve attachments, props, and original Redux post', async () => {
    const sender = await PrivateKeyMaterial.create();
    const recipient = await PrivateKeyMaterial.create();
    const original = {id: 'post', channel_id: 'channel', user_id: 'sender', message: 'Encrypted message', file_ids: ['file'], props: {other: true, e2ee: {signature: 'old'}}};
    const before = JSON.stringify(original);
    jest.spyOn(Client4, 'getChannelMembers').mockResolvedValue([{user_id: 'sender'}, {user_id: 'recipient'}] as any);
    const update = jest.spyOn(Client4, 'updatePost').mockImplementation(async (post) => post);
    const getKeys = jest.fn().mockResolvedValue({data: new Map([['sender', sender.pubKey()], ['recipient', recipient.pubKey()]])});
    await editEncryptedPost(original, 'edited secret', sender, getKeys);
    expect(update).toHaveBeenCalledTimes(1);
    const sent = update.mock.calls[0][0];
    expect(sent.message).not.toContain('edited secret');
    expect(sent.file_ids).toEqual(['file']);
    expect(sent.props.other).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    expect(await decryptPost(sent.props.e2ee, sender.pubKey(), recipient)).toBe('edited secret');
});

test('failed recipient lookup never submits an edit', async () => {
    const sender = await PrivateKeyMaterial.create();
    jest.spyOn(Client4, 'getChannelMembers').mockRejectedValue(new Error('offline'));
    const update = jest.spyOn(Client4, 'updatePost');
    await expect(editEncryptedPost({channel_id: 'channel', user_id: 'sender'}, 'secret', sender, jest.fn())).rejects.toThrow('offline');
    expect(update).not.toHaveBeenCalled();
});
