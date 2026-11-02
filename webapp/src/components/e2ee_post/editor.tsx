import React, {useEffect, useRef, useState} from 'react';

import {PrivateKeyMaterial} from '../../e2ee';
import {editEncryptedPost} from '../../editing';

export default function EncryptedEditor({post, text, privkey, getPubKeys, onSaved}: {post: any; text: string; privkey: PrivateKeyMaterial; getPubKeys: (ids: string[]) => Promise<any>; onSaved: (text: string) => void}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const changed = draft !== text;
    const canSave = !busy && Boolean(draft.trim()) && changed;
    const hintID = 'e2ee-edit-hint-' + post.id;
    const errorID = 'e2ee-edit-error-' + post.id;

    useEffect(() => {
        if (editing && textarea.current) {
            textarea.current.focus();
            const end = textarea.current.value.length;
            textarea.current.setSelectionRange(end, end);
        } else if (!editing) {
            setDraft('');
        }
    }, [editing]);

    const close = () => {
        setEditing(false);
        setError('');
        setDraft('');
        requestAnimationFrame(() => trigger.current?.focus());
    };
    const save = async () => {
        if (!canSave) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await editEncryptedPost(post, draft, privkey, getPubKeys);
            onSaved(draft);
            close();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    if (!editing) {
        return (
            <button
                ref={trigger}
                type='button'
                className='e2ee-edit-trigger'
                aria-label='Edit encrypted message'
                title='Edit encrypted message'
                onClick={() => {
                    setDraft(text);
                    setError('');
                    setEditing(true);
                }}
            >
                <svg
                    viewBox='0 0 24 24'
                    width='14'
                    height='14'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.7'
                    aria-hidden='true'
                >
                    <path d='m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z'/>
                </svg>
                <span>{'Edit'}</span>
            </button>
        );
    }
    return (
        <div
            className='e2ee-editor'
            aria-busy={busy}
        >
            <div className='e2ee-editor-heading'>
                <span>{'Edit message'}</span>
                <span className='e2ee-editor-badge'>{'End-to-end encrypted'}</span>
            </div>
            <textarea
                ref={textarea}
                className='e2ee-editor-input'
                aria-label='Edit encrypted message'
                aria-describedby={error ? hintID + ' ' + errorID : hintID}
                aria-invalid={Boolean(error)}
                rows={3}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || busy) {
                        return;
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        save();
                    }
                }}
            />
            {error && (
                <div
                    className='e2ee-editor-error'
                    id={errorID}
                    role='alert'
                >{error}</div>
            )}
            <div className='e2ee-editor-footer'>
                <span
                    className='e2ee-editor-hint'
                    id={hintID}
                >{'Ctrl/⌘ + Enter to save · Esc to cancel'}</span>
                <div className='e2ee-editor-actions'>
                    <button
                        type='button'
                        className='e2ee-editor-cancel'
                        disabled={busy}
                        onClick={close}
                    >{'Cancel'}</button>
                    <button
                        type='button'
                        className='e2ee-editor-save'
                        aria-label='Save encrypted edit'
                        disabled={!canSave}
                        onClick={save}
                    >
                        {busy && (
                            <span
                                className='e2ee-editor-spinner'
                                aria-hidden='true'
                            />
                        )}
                        <span role='status'>{busy ? 'Saving…' : 'Save changes'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
