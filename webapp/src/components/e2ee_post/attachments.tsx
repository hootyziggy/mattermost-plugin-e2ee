import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Client4} from 'mattermost-redux/client';

import {decryptAttachment, imagePreviewType} from '../../attachments';
import {PrivateKeyMaterial} from '../../e2ee';

type AttachmentProps = {postID: string; id: string; index: number; privkey: PrivateKeyMaterial | null | undefined; getPubKeys: (ids: string[]) => Promise<any>};
type Preview = {name: string; url: string | null; key: PrivateKeyMaterial};

async function loadAttachment({postID, id, privkey, getPubKeys}: AttachmentProps, signal: AbortSignal) {
    if (!privkey) {
        throw new Error('Import your private key first');
    }
    const infos = await Client4.getFileInfosForPost(postID);
    const info = infos.find((item) => item.id === id);
    if (!info) {
        throw new Error('Attachment no longer exists');
    }
    const {data: keys, error} = await getPubKeys([info.user_id]);
    if (error || !keys || !keys.get(info.user_id)) {
        throw new Error('Unable to verify the attachment sender');
    }
    if (signal.aborted) {
        throw new Error('Attachment request cancelled');
    }
    const response = await fetch(Client4.getFileUrl(id, 0), {credentials: 'same-origin', signal});
    if (!response.ok) {
        throw new Error('Unable to download attachment');
    }
    return decryptAttachment(await response.arrayBuffer(), info.user_id, keys.get(info.user_id), privkey);
}

function EncryptedAttachment(props: AttachmentProps) {
    const {postID, id, index, privkey, getPubKeys} = props;
    const [visible, setVisible] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const imageButton = useRef<HTMLButtonElement>(null);
    const downloadRequest = useRef<AbortController | null>(null);
    const currentPreview = preview?.key === privkey ? preview : null;

    useEffect(() => {
        const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisible(true);
                observer!.disconnect();
            }
        }, {rootMargin: '200px'});
        if (observer && container.current) {
            observer.observe(container.current);
        } else {
            setVisible(true);
        }
        return () => {
            if (observer) {
                observer.disconnect();
            }
        };
    }, []);

    useEffect(() => {
        if (downloadRequest.current) {
            downloadRequest.current.abort();
        }
        setBusy(false);
        setPreview(null);
        setImageFailed(false);
        setExpanded(false);
        setError('');
        let active = true;
        let url: string | null = null;
        const controller = new AbortController();
        if (visible && privkey) {
            loadAttachment({postID, id, index, privkey, getPubKeys}, controller.signal).then((file) => {
                if (!active) {
                    return;
                }
                const type = imagePreviewType(file);
                if (type) {
                    url = URL.createObjectURL(new Blob([file.blob], {type}));
                }
                setPreview({name: file.name, url, key: privkey});
            }).catch((e) => {
                if (active) {
                    setError(e.message);
                }
            });
        }
        return () => {
            active = false;
            controller.abort();
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [visible, postID, id, index, privkey, getPubKeys]);

    useEffect(() => () => downloadRequest.current?.abort(), [postID, id, privkey]);

    const closePreview = useCallback(() => {
        setExpanded(false);
        requestAnimationFrame(() => imageButton.current?.focus());
    }, []);
    useEffect(() => {
        const element = dialog.current;
        if (expanded && element) {
            element.addEventListener('cancel', closePreview);
            if (!element.open) {
                element.showModal();
            }
        }
        return () => {
            if (element) {
                element.removeEventListener('cancel', closePreview);
            }
        };
    }, [expanded, closePreview]);

    const download = async () => {
        setBusy(true);
        setError('');
        const controller = new AbortController();
        downloadRequest.current = controller;
        try {
            let url = currentPreview?.url;
            let name = currentPreview?.name || '';
            let temporaryURL = false;
            if (!url) {
                const file = await loadAttachment(props, controller.signal);
                if (controller.signal.aborted) {
                    return;
                }
                name = file.name;
                url = URL.createObjectURL(file.blob);
                temporaryURL = true;
            }
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            if (temporaryURL) {
                setTimeout(() => URL.revokeObjectURL(url!), 60000);
            }
        } catch (e) {
            if (!controller.signal.aborted) {
                setError(e.message);
            }
        } finally {
            if (!controller.signal.aborted) {
                setBusy(false);
            }
        }
    };
    return (
        <div
            className='e2ee-attachment'
            ref={container}
        >
            {currentPreview?.url && !imageFailed && (
                <figure className='e2ee-image-preview'>
                    <button
                        type='button'
                        className='e2ee-image-open'
                        aria-label={'Preview ' + currentPreview.name}
                        ref={imageButton}
                        onClick={() => setExpanded(true)}
                    >
                        <img
                            src={currentPreview.url}
                            alt={currentPreview.name}
                            onError={() => setImageFailed(true)}
                        />
                    </button>
                    <figcaption>{currentPreview.name}</figcaption>
                </figure>
            )}
            {imageFailed && <div className='e2ee-image-unavailable'>{'This image format cannot be previewed in your browser. Download it to view.'}</div>}
            <button
                type='button'
                className='e2ee-attachment-download'
                disabled={busy || !privkey}
                aria-label={'Decrypt and download attachment ' + (index + 1)}
                onClick={download}
            >{busy ? 'Decrypting…' : 'Download ' + (currentPreview?.name || 'encrypted attachment ' + (index + 1))}</button>
            {error && (
                <div
                    className='e2ee-editor-error'
                    role='alert'
                >{error}</div>
            )}
            {expanded && currentPreview?.url && (
                <dialog
                    ref={dialog}
                    className='e2ee-image-dialog'
                    aria-label={'Image preview: ' + currentPreview.name}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            closePreview();
                        }
                    }}
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closePreview();
                        }
                    }}
                >
                    <div className='e2ee-image-dialog-heading'>
                        <span>{currentPreview.name}</span>
                        <button
                            type='button'
                            onClick={closePreview}
                        >{'Close preview'}</button>
                    </div>
                    <img
                        src={currentPreview.url}
                        alt={currentPreview.name}
                    />
                </dialog>
            )}
        </div>
    );
}

export default function EncryptedAttachments({post, privkey, getPubKeys}: {post: any; privkey: PrivateKeyMaterial | null | undefined; getPubKeys: (ids: string[]) => Promise<any>}) {
    return (
        <div className='e2ee-attachments'>
            {(post.file_ids || []).map((id: string, index: number) => (
                <EncryptedAttachment
                    key={id}
                    postID={post.id}
                    id={id}
                    index={index}
                    privkey={privkey}
                    getPubKeys={getPubKeys}
                />
            ))}
        </div>
    );
}
