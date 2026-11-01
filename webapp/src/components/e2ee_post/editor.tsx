import React, {useState} from 'react';

import {PrivateKeyMaterial} from '../../e2ee';
import {editEncryptedPost} from '../../editing';

export default function EncryptedEditor({post, text, privkey, getPubKeys, onSaved}: {post: any; text: string; privkey: PrivateKeyMaterial; getPubKeys: (ids: string[]) => Promise<any>; onSaved: (text: string) => void}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await editEncryptedPost(post, draft, privkey, getPubKeys);
            onSaved(draft);
            setEditing(false);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    if (!editing) {
        return (
            <button
                type='button'
                className='btn btn-link'
                onClick={() => {
                    setDraft(text);
                    setEditing(true);
                }}
            >{'Edit encrypted message'}</button>
        );
    }
    return (
        <div>
            <textarea
                aria-label='Edit encrypted message'
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
            />
            <button
                type='button'
                disabled={busy || !draft.trim()}
                onClick={save}
            >{'Save encrypted edit'}</button>
            <button
                type='button'
                disabled={busy}
                onClick={() => {
                    setEditing(false);
                    setDraft('');
                }}
            >{'Cancel'}</button>
            {error && <div role='alert'>{error}</div>}
        </div>
    );
}
