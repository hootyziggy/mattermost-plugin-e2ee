import {Client4} from 'mattermost-redux/client';

import {PrivateKeyMaterial, PublicKeyMaterial} from './e2ee';
import {encryptPost} from './e2ee_post';
import {msgCache} from './msg_cache';

export async function editEncryptedPost(post: any, text: string, key: PrivateKeyMaterial, getPubKeys: (ids: string[]) => Promise<any>) {
    const recipients = new Set<string>([post.user_id]);
    for (let page = 0; ; page++) {
        // eslint-disable-next-line no-await-in-loop
        const members = await Client4.getChannelMembers(post.channel_id, page, 200);
        members.forEach((member: any) => recipients.add(member.user_id));
        if (members.length < 200) {
            break;
        }
    }
    const {data: keys, error} = await getPubKeys(Array.from(recipients));
    if (error || !keys || !keys.size) {
        throw new Error('Unable to get channel encryption keys');
    }
    const updated = {...post, props: {...post.props}, message: text};
    await encryptPost(updated, key, Array.from(keys.values()) as PublicKeyMaterial[]);
    updated.message += ' ' + Date.now();
    const saved = await Client4.updatePost(updated);
    msgCache.addUpdated(saved, text);
    return saved;
}
