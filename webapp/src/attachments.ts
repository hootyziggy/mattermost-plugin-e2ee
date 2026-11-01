import {EncryptedP2PMessage, PrivateKeyMaterial, PublicKeyMaterial} from './e2ee';

export const ATTACHMENT_FORMAT = 'mattermost-e2ee-file-v1';
export const ATTACHMENT_MAGIC = 'MME2EE\u0000';
export const ATTACHMENT_NAME = 'encrypted.e2ee';

// Whole-file authenticated encryption needs several copies in browser memory.
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

export function readBlob(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Unable to read attachment'));
        reader.readAsArrayBuffer(blob);
    });
}

export async function encryptAttachment(file: File, senderID: string, key: PrivateKeyMaterial, recipients: PublicKeyMaterial[]): Promise<File> {
    if (file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error('Encrypted attachments are limited to 20 MiB each');
    }
    const metadata = new TextEncoder().encode(JSON.stringify({name: file.name, type: file.type, senderID}));
    const data = new Uint8Array(await readBlob(file));
    const plaintext = new Uint8Array(4 + metadata.length + data.length);
    new DataView(plaintext.buffer).setUint32(0, metadata.length);
    plaintext.set(metadata, 4);
    plaintext.set(data, 4 + metadata.length);
    const message = await EncryptedP2PMessage.encrypt(plaintext.buffer, key, [...recipients, key.pubKey()]);
    const envelope = {format: ATTACHMENT_FORMAT, sender_id: senderID, message: await message.jsonable(true)};
    return new File([ATTACHMENT_MAGIC, JSON.stringify(envelope)], ATTACHMENT_NAME, {type: 'application/octet-stream'});
}

export async function decryptAttachment(data: ArrayBuffer, senderID: string, sender: PublicKeyMaterial, key: PrivateKeyMaterial): Promise<{name: string; blob: Blob}> {
    const encoded = new TextDecoder().decode(data);
    if (!encoded.startsWith(ATTACHMENT_MAGIC)) {
        throw new Error('Invalid encrypted attachment');
    }
    const envelope = JSON.parse(encoded.slice(ATTACHMENT_MAGIC.length));
    if (envelope.format !== ATTACHMENT_FORMAT || envelope.sender_id !== senderID) {
        throw new Error('Invalid encrypted attachment');
    }
    const message = await EncryptedP2PMessage.fromJsonable(envelope.message, true);
    const plaintext = await message.verifyAndDecrypt(sender, key);
    if (plaintext.byteLength < 4) {
        throw new Error('Invalid attachment metadata');
    }
    const metadataLength = new DataView(plaintext).getUint32(0);
    if (metadataLength > plaintext.byteLength - 4) {
        throw new Error('Invalid attachment metadata');
    }
    const metadata = JSON.parse(new TextDecoder().decode(plaintext.slice(4, 4 + metadataLength)));
    if (metadata.senderID !== senderID || typeof metadata.name !== 'string' || typeof metadata.type !== 'string') {
        throw new Error('Invalid attachment identity');
    }
    return {name: metadata.name, blob: new Blob([plaintext.slice(4 + metadataLength)], {type: 'application/octet-stream'})};
}
