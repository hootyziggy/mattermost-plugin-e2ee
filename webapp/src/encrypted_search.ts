import {Post} from 'mattermost-redux/types/posts';

import {PrivateKeyMaterial, PublicKeyMaterial} from './e2ee';
import {decryptPost, isEncryptedPost} from './e2ee_post';
import {E2EE_POST_TYPE} from './constants';

export const OPEN_ENCRYPTED_SEARCH = 'e2ee-open-encrypted-search';
export type SearchPage = {order: string[]; posts: {[id: string]: Post}};
export type SearchChannel = {id: string; display_name: string};
export type SearchCursor = {channel: number; before?: string};
export type SearchMatch = {id: string; userID: string; channelName: string; createAt: number; text: string};
export type SearchProgress = {results: SearchMatch[]; scanned: number; unreadable: number};
export type SearchOutcome = SearchProgress & {cursor: SearchCursor | null};

type SearchOptions = {
    query: string;
    channels: SearchChannel[];
    key: PrivateKeyMaterial;
    signal: AbortSignal;
    fetchPage: (channelID: string, before?: string) => Promise<SearchPage>;
    getKeys: (ids: string[]) => Promise<Map<string, PublicKeyMaterial>>;
    onProgress?: (progress: SearchProgress) => void;
    cursor?: SearchCursor | null;
    maxResults?: number;
    maxScanned?: number;
};

function checkCancelled(signal: AbortSignal) {
    if (signal.aborted) {
        const error = new Error('Search stopped');
        error.name = 'AbortError';
        throw error;
    }
}

// The query is used only here. Fetchers receive channel/post IDs, never search terms.
export async function searchEncryptedMessages(options: SearchOptions): Promise<SearchOutcome> {
    const query = options.query.trim().toLocaleLowerCase();
    if (!query) {
        throw new Error('Enter a word or phrase to search for');
    }
    const {channels, key, signal, fetchPage, getKeys, onProgress} = options;
    const results: SearchMatch[] = [];
    let scanned = 0;
    let unreadable = 0;
    let channel = options.cursor?.channel || 0;
    let before = options.cursor?.before;
    const maxResults = options.maxResults || 100;
    const maxScanned = options.maxScanned || 5000;
    const seen = new Set<string>();
    const progress = () => {
        checkCancelled(signal);
        if (onProgress) {
            onProgress({results: [...results], scanned, unreadable});
        }
    };
    while (channel < channels.length) {
        checkCancelled(signal);
        // eslint-disable-next-line no-await-in-loop
        const page = await fetchPage(channels[channel].id, before);
        checkCancelled(signal);
        if (!page.order.length) {
            channel++;
            before = '';
            continue;
        }
        if (page.order.every((id) => seen.has(id))) {
            throw new Error('Channel history did not advance; search is incomplete');
        }
        const posts = page.order.map((id) => page.posts[id]).filter(Boolean);
        const encrypted = posts.filter((post) => !post.delete_at && String(post.type) === E2EE_POST_TYPE);
        const ids = Array.from(new Set(encrypted.map((post) => post.user_id)));
        // eslint-disable-next-line no-await-in-loop
        const keys = ids.length ? await getKeys(ids) : new Map<string, PublicKeyMaterial>();
        checkCancelled(signal);
        const previous = before;
        for (const id of page.order) {
            checkCancelled(signal);
            before = id;
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            const post: Post | null = page.posts[id] || null;
            scanned++;
            if (post && !post.delete_at && String(post.type) === E2EE_POST_TYPE) {
                const sender = keys.get(post.user_id);
                if (sender && isEncryptedPost(post)) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const text = await decryptPost(post.props.e2ee, sender, key);
                        checkCancelled(signal);
                        if (text.toLocaleLowerCase().includes(query)) {
                            results.push({id: post.id, userID: post.user_id, channelName: channels[channel].display_name, createAt: post.create_at, text});
                        }
                    } catch (error) {
                        checkCancelled(signal);
                        unreadable++;
                    }
                } else {
                    unreadable++;
                }
            }
            if (scanned % 25 === 0 || results.length >= maxResults || scanned >= maxScanned) {
                progress();
            }
            if (results.length >= maxResults || scanned >= maxScanned) {
                return {results, scanned, unreadable, cursor: {channel, before}};
            }
        }
        progress();
        if (before === previous) {
            throw new Error('Channel history did not advance; search is incomplete');
        }
    }
    progress();
    return {results, scanned, unreadable, cursor: null};
}
