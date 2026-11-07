import {PrivateKeyMaterial} from '../src/e2ee';
import {encryptPost} from '../src/e2ee_post';
import {searchEncryptedMessages, SearchPage} from '../src/encrypted_search';

async function encrypted(id, text, sender, recipient) {
    const post: any = {id, user_id: 'sender', channel_id: 'channel', create_at: 1, message: text, props: {}};
    await encryptPost(post, sender, [sender.pubKey(), recipient.pubKey()]);
    return post;
}
function page(posts): SearchPage {
    return {order: posts.map((p) => p.id), posts: Object.fromEntries(posts.map((p) => [p.id, p]))};
}

test('searches and verifies encrypted history locally without mutating posts or sending query terms', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const posts = [await encrypted('new', 'Secret phrase HERE', sender, key), await encrypted('old', 'another secret phrase', sender, key)];
    const original = JSON.stringify(posts);
    const fetchPage = jest.fn().mockResolvedValueOnce(page([posts[0]])).mockResolvedValueOnce(page([posts[1]])).mockResolvedValueOnce(page([]));
    const result = await searchEncryptedMessages({query: 'secret PHRASE', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map([['sender', sender.pubKey()]])});
    expect(result.results.map((p) => p.id)).toEqual(['new', 'old']);
    expect(result.cursor).toBeNull();
    expect(result.unreadable).toBe(0);
    expect(JSON.stringify(posts)).toBe(original);
    expect(fetchPage.mock.calls.map((c) => c.slice(0, 1))).toEqual([['channel'], ['channel'], ['channel']]);
    expect(JSON.stringify(fetchPage.mock.calls)).not.toContain('secret');
});

test('continues from the last processed post without dropping the rest of a page', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const first = await encrypted('first', 'match one', sender, key);
    const second = await encrypted('second', 'match two', sender, key);
    const fetchPage = jest.fn(async (channel, before) => {
        if (before === 'first') {
            return page([second]);
        }
        return page(before === 'second' ? [] : [first, second]);
    });
    const options = {query: 'match', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map([['sender', sender.pubKey()]]), maxResults: 1};
    const batch1 = await searchEncryptedMessages(options);
    const batch2 = await searchEncryptedMessages({...options, cursor: batch1.cursor});
    const batch3 = await searchEncryptedMessages({...options, cursor: batch2.cursor});
    expect([...batch1.results, ...batch2.results].map((p) => p.id)).toEqual(['first', 'second']);
    expect(batch3.cursor).toBeNull();
});

test('unreadable and tampered ciphertext never produce matches', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const other = await PrivateKeyMaterial.create();
    const bad = await encrypted('tampered', 'secret', sender, key);
    bad.props.e2ee.signature = 'AAAA';
    const unreadable = await encrypted('unreadable', 'secret', sender, other);
    const fetchPage = jest.fn().mockResolvedValueOnce(page([bad, unreadable])).mockResolvedValueOnce(page([]));
    const result = await searchEncryptedMessages({query: 'secret', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map([['sender', sender.pubKey()]])});
    expect(result.results).toEqual([]);
    expect(result.unreadable).toBe(2);
});

test('aborting during key lookup suppresses decrypted results and progress', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const post = await encrypted('post', 'secret', sender, key);
    const controller = new AbortController();
    const onProgress = jest.fn();
    await expect(searchEncryptedMessages({query: 'secret',
        channels: [{id: 'channel', display_name: 'Channel'}],
        key,
        signal: controller.signal,
        fetchPage: async () => page([post]),
        getKeys: async () => {
            controller.abort();
            return new Map([['sender', sender.pubKey()]]);
        },
        onProgress})).rejects.toThrow('Search stopped');
    expect(onProgress).not.toHaveBeenCalled();
});

test('repeated history pages fail explicitly instead of looping or claiming completeness', async () => {
    const key = await PrivateKeyMaterial.create();
    const post: any = {id: 'plain', type: '', message: 'secret'};
    await expect(searchEncryptedMessages({query: 'secret', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage: async () => page([post]), getKeys: async () => new Map()})).rejects.toThrow('did not advance');
});

test('scan-budget continuation advances across channels without reusing the previous cursor', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const plain: any = {id: 'plain', type: '', message: 'match'};
    const matching = await encrypted('matching', 'match', sender, key);
    const fetchPage = jest.fn(async (channel, before) => {
        if (before) {
            return page([]);
        }
        return page(channel === 'one' ? [plain] : [matching]);
    });
    const options = {query: 'match', channels: [{id: 'one', display_name: 'One'}, {id: 'two', display_name: 'Two'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map([['sender', sender.pubKey()]]), maxScanned: 1};
    const first = await searchEncryptedMessages(options);
    expect(first.results).toEqual([]);
    expect(first.cursor).toEqual({channel: 0, before: 'plain'});
    const second = await searchEncryptedMessages({...options, cursor: first.cursor});
    expect(second.results.map((p) => p.id)).toEqual(['matching']);
    expect(fetchPage.mock.calls.some(([channel, before]) => channel === 'two' && !before)).toBe(true);
});

test('missing sender keys and malformed encrypted messages are counted; plaintext and deleted posts are excluded', async () => {
    const sender = await PrivateKeyMaterial.create();
    const key = await PrivateKeyMaterial.create();
    const missing = await encrypted('missing', 'secret', sender, key);
    const deleted = {...missing, id: 'deleted', delete_at: 1};
    const malformed: any = {id: 'malformed', type: 'custom_e2ee', user_id: 'sender'};
    const plain: any = {id: 'plain', type: '', message: 'secret'};
    const fetchPage = jest.fn().mockResolvedValueOnce(page([missing, malformed, deleted, plain])).mockResolvedValueOnce(page([]));
    const result = await searchEncryptedMessages({query: 'secret', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map()});
    expect(result.results).toEqual([]);
    expect(result.unreadable).toBe(2);
    expect(result.scanned).toBe(4);
});

test('empty queries do not fetch history', async () => {
    const key = await PrivateKeyMaterial.create();
    const fetchPage = jest.fn(async () => page([]));
    await expect(searchEncryptedMessages({query: '   ', channels: [{id: 'channel', display_name: 'Channel'}], key, signal: new AbortController().signal, fetchPage, getKeys: async () => new Map()})).rejects.toThrow('Enter a word or phrase');
    expect(fetchPage).not.toHaveBeenCalled();
});
