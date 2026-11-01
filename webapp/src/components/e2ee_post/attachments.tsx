import React, {useState} from 'react';
import {Client4} from 'mattermost-redux/client';

import {decryptAttachment} from '../../attachments';
import {PrivateKeyMaterial} from '../../e2ee';

export default function EncryptedAttachments({post, privkey, getPubKeys}: {post: any; privkey: PrivateKeyMaterial | null | undefined; getPubKeys: (ids: string[]) => Promise<any>}) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const download = async (id: string) => {
        setBusy(true);
        setError('');
        try {
            if (!privkey) {
                throw new Error('Import your private key first');
            }

            // The file creator may differ from the post author after an edit.
            const infos = await Client4.getFileInfosForPost(post.id);
            const info = infos.find((item) => item.id === id);
            if (!info) {
                throw new Error('Attachment no longer exists');
            }
            const {data: keys, error: keyError} = await getPubKeys([info.user_id]);
            if (keyError || !keys || !keys.get(info.user_id)) {
                throw new Error('Unable to verify the attachment sender');
            }
            const response = await fetch(Client4.getFileUrl(id, 0), {credentials: 'same-origin'});
            if (!response.ok) {
                throw new Error('Unable to download attachment');
            }
            const file = await decryptAttachment(await response.arrayBuffer(), info.user_id, keys.get(info.user_id), privkey);
            const url = URL.createObjectURL(file.blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = file.name;
            document.body.appendChild(link);
            link.click();
            link.remove();

            // Allow the browser to begin consuming the URL before revoking it.
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div>
            {(post.file_ids || []).map((id: string, index: number) => (
                <button
                    key={id}
                    type='button'
                    className='btn btn-link'
                    disabled={busy}
                    onClick={() => download(id)}
                >
                    {'Decrypt and download attachment ' + (index + 1)}
                </button>
            ))}
            {error && <div role='alert'>{error}</div>}
        </div>
    );
}
