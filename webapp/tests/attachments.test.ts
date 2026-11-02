import {encryptAttachment, decryptAttachment, readBlob, MAX_ATTACHMENT_SIZE, ATTACHMENT_MAGIC, imagePreviewType} from '../src/attachments';
import {PrivateKeyMaterial} from '../src/e2ee';

const b64 = require('base64-arraybuffer');

test('attachments encrypt bytes and filename for recipients, including sender', async () => {
    const sender = await PrivateKeyMaterial.create();
    const recipient = await PrivateKeyMaterial.create();
    const outsider = await PrivateKeyMaterial.create();
    const input = new File([new Uint8Array([0, 255, 1, 128]), 'secret content'], 'secret.pdf', {type: 'application/pdf'});
    const encrypted = await encryptAttachment(input, 'sender', sender, [recipient.pubKey()]);
    const data = await readBlob(encrypted);
    const wire = new TextDecoder().decode(data);
    expect(encrypted.name).toBe('encrypted.e2ee');
    expect(wire).not.toContain('secret.pdf');
    expect(wire).not.toContain('secret content');
    await Promise.all([sender, recipient].map(async (key) => {
        const result = await decryptAttachment(data, 'sender', sender.pubKey(), key);
        expect(result.name).toBe(input.name);
        expect(result.type).toBe(input.type);
        expect(result.blob.type).toBe('application/octet-stream');
        expect(new Uint8Array(await readBlob(result.blob))).toEqual(new Uint8Array(await readBlob(input)));
    }));
    await expect(decryptAttachment(data, 'sender', sender.pubKey(), outsider)).rejects.toThrow();
    await expect(decryptAttachment(data, 'other', sender.pubKey(), recipient)).rejects.toThrow();
    const envelope = JSON.parse(wire.slice(ATTACHMENT_MAGIC.length));
    const bytes = new Uint8Array(b64.decode(envelope.message.encryptedData));
    bytes[0] ^= 1;
    envelope.message.encryptedData = b64.encode(bytes.buffer);
    await expect(decryptAttachment(new TextEncoder().encode(ATTACHMENT_MAGIC + JSON.stringify(envelope)).buffer, 'sender', sender.pubKey(), recipient)).rejects.toThrow();
});

test('oversized uploads fail before reading or encrypting', async () => {
    const key = await PrivateKeyMaterial.create();
    const file = new File(['x'], 'large');
    Object.defineProperty(file, 'size', {value: MAX_ATTACHMENT_SIZE + 1});
    await expect(encryptAttachment(file, 'sender', key, [])).rejects.toThrow('20 MiB');
});

test.each([
    ['photo.png', 'image/png', 'image/png'],
    ['photo', 'IMAGE/JPEG; charset=utf-8', 'image/jpeg'],
    ['animation.gif', '', 'image/gif'],
    ['photo.WEBP', 'application/octet-stream', 'image/webp'],
    ['vector.svg', 'image/svg+xml', 'image/svg+xml'],
    ['photo.avif', '', 'image/avif'],
    ['photo.png', 'text/html', null],
    ['document.pdf', 'application/pdf', null],
    ['__proto__', '', null],
    ['document', '', null],
])('image preview detection: %s (%s)', (name, type, expected) => {
    expect(imagePreviewType({name, type})).toBe(expected);
});
