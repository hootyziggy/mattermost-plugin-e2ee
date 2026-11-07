import React from 'react';
import {Store, Action} from 'redux';
import {GlobalState} from 'mattermost-redux/types/store';

import manifest from './manifest';
import {APIClient} from './client';
import {getServerRoute} from './selectors';
import Reducer from './reducers';
import {E2EE_POST_TYPE} from './constants';
import E2EEPost from './components/e2ee_post';
// eslint-disable-next-line import/no-unresolved
import {PluginRegistry} from './types/mattermost-webapp';
import E2EEHooks from './hooks';
import E2EEImportModal from './components/e2ee_import_modal';
import {setE2EEPostUpdateSupported} from './compat';
import EncryptedSearch from './components/encrypted_search';
import SearchIcon from './components/encrypted_search/icon';
import {OPEN_ENCRYPTED_SEARCH} from './encrypted_search';

const b64 = require('base64-arraybuffer');

export default class Plugin {
    hooks?: E2EEHooks

    public async initialize(registry: PluginRegistry, store: Store<GlobalState, Action<Record<string, unknown>>>) {
        // The standard editor in Mattermost 12 does not call update hooks.
        // Use our encrypted editor and never put decrypted text in Redux posts.
        setE2EEPostUpdateSupported(false);

        this.hooks = new E2EEHooks(store);
        this.hooks.register(registry);

        registry.registerRootComponent(E2EEImportModal);
        registry.registerRootComponent(() => React.createElement(EncryptedSearch, {store}));
        registry.registerChannelHeaderButtonAction(
            React.createElement(SearchIcon),
            () => window.dispatchEvent(new Event(OPEN_ENCRYPTED_SEARCH)),
            'Search encrypted messages',
            'Search encrypted messages',
        );
        registry.registerReducer(Reducer);
        registry.registerPostTypeComponent(E2EE_POST_TYPE, E2EEPost);

        APIClient.setServerRoute(getServerRoute(store.getState()));
    }
}

declare global {
    interface Window {
        registerPlugin(id: string, plugin: Plugin): void
    }
}

window.registerPlugin(manifest.id, new Plugin());
