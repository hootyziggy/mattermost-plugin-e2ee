import React, {useCallback, useEffect, useRef, useState} from 'react';
import {connect} from 'react-redux';
import {Store} from 'redux';
import {Modal} from 'react-bootstrap';
import {Client4} from 'mattermost-redux/client';
import {GlobalState} from 'mattermost-redux/types/store';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';
import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/common';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';

import {selectPrivkey, getServerRoute} from '../../selectors';
import {getPubKeys} from '../../actions';
import {OPEN_ENCRYPTED_SEARCH, searchEncryptedMessages, SearchChannel, SearchCursor, SearchProgress, SearchPage} from '../../encrypted_search';

import './search.css';

function mapState(state: GlobalState) {
    const channelID = getCurrentChannelId(state);
    return {keyMaterial: selectPrivkey(state), userID: getCurrentUserId(state), channel: getChannel(state, channelID), basePath: getServerRoute(state)};
}

type Props = ReturnType<typeof mapState> & {store: Store};
const emptyProgress: SearchProgress = {results: [], scanned: 0, unreadable: 0};

function EncryptedSearch({store, keyMaterial, userID, channel, basePath}: Props) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState('channel');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(emptyProgress);
    const [cursor, setCursor] = useState<SearchCursor | null>(null);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const channels = useRef<SearchChannel[]>([]);
    const input = useRef<HTMLInputElement>(null);
    const close = useCallback(() => {
        if (controller.current) {
            controller.current.abort();
        }
        setOpen(false);
        setQuery('');
        setProgress(emptyProgress);
        setCursor(null);
        setStatus('');
        setError('');
        setBusy(false);
        channels.current = [];
    }, []);

    useEffect(() => {
        const show = () => setOpen(true);
        window.addEventListener(OPEN_ENCRYPTED_SEARCH, show);
        return () => window.removeEventListener(OPEN_ENCRYPTED_SEARCH, show);
    }, []);
    useEffect(() => {
        close();
        return () => controller.current?.abort();
    }, [keyMaterial, userID, channel?.id, close]);

    const reset = () => {
        setProgress(emptyProgress);
        setCursor(null);
        setStatus('');
        setError('');
    };
    const search = async (older = false) => {
        if (!keyMaterial || !channel || !query.trim()) {
            return;
        }
        if (controller.current) {
            controller.current.abort();
        }
        const request = new AbortController();
        controller.current = request;
        setBusy(true);
        setError('');
        setStatus('Searching…');
        const prior = older ? progress : emptyProgress;
        if (!older) {
            setProgress(emptyProgress);
            setCursor(null);
        }
        try {
            if (!older) {
                channels.current = [{id: channel.id, display_name: channel.display_name || channel.name}];
                if (scope === 'all') {
                    const teams = await Client4.getMyTeams();
                    if (request.signal.aborted) {
                        return;
                    }
                    const joined = new Map<string, SearchChannel>();
                    for (const team of teams) {
                        // eslint-disable-next-line no-await-in-loop
                        const list = await Client4.getMyChannels(team.id);
                        if (request.signal.aborted) {
                            return;
                        }
                        list.filter((item) => !item.delete_at).forEach((item) => joined.set(item.id, {id: item.id, display_name: item.display_name || item.name}));
                    }
                    joined.set(channel.id, channels.current[0]);
                    channels.current = Array.from(joined.values());
                }
            }
            const update = (next: SearchProgress) => {
                if (!request.signal.aborted) {
                    setProgress({results: [...prior.results, ...next.results], scanned: prior.scanned + next.scanned, unreadable: prior.unreadable + next.unreadable});
                }
            };
            const result = await searchEncryptedMessages({
                query,
                channels: channels.current,
                key: keyMaterial,
                signal: request.signal,
                cursor: older ? cursor : null,
                fetchPage: async (id, before) => {
                    // The legacy types declare Map; the HTTP response is a JSON object.
                    const page = await (before ? Client4.getPostsBefore(id, before, 0, 100, false) : Client4.getPosts(id, 0, 100, false));
                    return page as unknown as SearchPage;
                },
                getKeys: async (ids) => {
                    const response = await store.dispatch<any>(getPubKeys(ids));
                    if (response.error) {
                        throw new Error('Unable to load sender keys; search is incomplete');
                    }
                    return response.data;
                },
                onProgress: update,
            });
            if (!request.signal.aborted) {
                update(result);
                setCursor(result.cursor);
                setStatus(result.cursor ? 'Partial history searched. Continue to check older messages.' : 'Search complete for the selected channels.');
            }
        } catch (e) {
            if (!request.signal.aborted) {
                setError(e.message);
                setStatus('Search incomplete. Try searching again.');
                setCursor(null);
            }
        } finally {
            if (!request.signal.aborted) {
                setBusy(false);
            }
        }
    };
    return (
        <Modal
            show={open}
            onHide={close}
            bsSize='large'
            onEntered={() => input.current?.focus()}
        >
            <Modal.Header closeButton={true}>
                <Modal.Title>{'Search encrypted messages'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p className='e2ee-search-privacy'>{'Decryption and matching happen in your browser. Your search terms and decrypted messages are not sent to the server.'}</p>
                {!keyMaterial && <p role='alert'>{'Import your private key or run /e2ee init before searching.'}</p>}
                <form
                    className='e2ee-search-form'
                    onSubmit={(event) => {
                        event.preventDefault();
                        search();
                    }}
                >
                    <input
                        ref={input}
                        type='search'
                        className='form-control'
                        aria-label='Search encrypted messages'
                        placeholder='Find a word or phrase…'
                        autoComplete='off'
                        spellCheck={false}
                        value={query}
                        disabled={busy}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            reset();
                        }}
                    />
                    <select
                        className='form-control'
                        aria-label='Search scope'
                        value={scope}
                        disabled={busy}
                        onChange={(event) => {
                            setScope(event.target.value);
                            reset();
                        }}
                    >
                        <option value='channel'>{channel ? channel.display_name || channel.name : 'Current channel'}</option>
                        <option value='all'>{'All joined channels'}</option>
                    </select>
                    <button
                        type='submit'
                        className='btn btn-primary'
                        disabled={busy || !keyMaterial || !query.trim()}
                    >{'Search'}</button>
                </form>
                {busy && (
                    <button
                        type='button'
                        className='btn btn-link'
                        onClick={() => {
                            if (controller.current) {
                                controller.current.abort();
                            }
                            setBusy(false);
                            setCursor(null);
                            setStatus('Search stopped. Results cover only messages checked so far.');
                        }}
                    >{'Stop search'}</button>
                )}
                <div
                    className='e2ee-search-status'
                    role='status'
                >
                    {status && <p>{status}</p>}
                    {status && <p>{progress.results.length + (progress.results.length === 1 ? ' match · ' : ' matches · ') + progress.scanned + ' messages checked · ' + progress.unreadable + ' could not be decrypted'}</p>}
                </div>
                {error && (
                    <div
                        role='alert'
                        className='e2ee-editor-error'
                    >{error}</div>
                )}
                <ul className='e2ee-search-results'>
                    {progress.results.map((match) => (
                        <li key={match.id}>
                            <div className='e2ee-search-result-meta'>{match.channelName + ' · ' + new Date(match.createAt).toLocaleString()}</div>
                            <p className='e2ee-search-message'>{match.text}</p>
                            <a
                                href={basePath + '/_redirect/pl/' + encodeURIComponent(match.id)}
                                onClick={close}
                            >{'Open message'}</a>
                        </li>
                    ))}
                </ul>
                {cursor && !busy && (
                    <button
                        type='button'
                        className='btn btn-default'
                        onClick={() => search(true)}
                    >{'Search older messages'}</button>
                )}
            </Modal.Body>
            <Modal.Footer className='e2ee-search-footer'>
                <span className='e2ee-search-limit'>{'Only messages decryptable with your current key can match. Attachment contents are not searched.'}</span>
                <button
                    type='button'
                    className='btn btn-link'
                    onClick={close}
                >{'Close'}</button>
            </Modal.Footer>
        </Modal>
    );
}

export default connect(mapState)(EncryptedSearch);
