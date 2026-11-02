/* eslint max-nested-callbacks: ["error", 3] */

import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';

// @ts-ignore
const {formatText, messageHtmlToComponent} = window.PostUtils;

import {decryptPost} from 'e2ee_post';
import {E2EEUnknownRecipient} from 'e2ee';
import {msgCache} from 'msg_cache';

import EncryptedEditor from './editor';
import EncryptedAttachments from './attachments';

import {E2EEPostProps} from './index';
import './e2ee_post.css';

export const E2EEPost: React.FC<E2EEPostProps> = (props) => {
    const {post, privkey, currentUserID, actions} = props;

    const [msgText, setMsgText] = useState<React.ReactNode>('');
    const [plaintext, setPlaintext] = useState<string | null>(null);
    const [headerClasses, setHeaderClasses] = useState('e2ee_post_header');
    const [postClasses, setPostClasses] = useState('e2ee_post_body');

    const formatOptions = {
        atMentions: true,
        editedAt: post.edit_at,
        postId: post.id,
    };
    const componentOptions = {
        editedAt: post.edit_at,
        postId: post.id,
        channelId: post.channel_id,
    };

    const setMsgSuccess = (text: string) => {
        setPlaintext(text);
        if (text.length > 0) {
            const ftxt = messageHtmlToComponent(formatText(text, formatOptions), false, componentOptions);
            setMsgText(ftxt);
            setHeaderClasses('e2ee_post_header');
            setPostClasses('e2ee_post_body post--edited');
        } else {
            setHeaderClasses('e2ee_post_header e2ee__hidden');
            setPostClasses('e2ee_post_body e2ee__hidden');
        }
    };

    const setMsgError = (text: string) => {
        setPlaintext(null);
        setMsgText(text);
        setPostClasses('e2ee_post_body e2ee__error');
        setHeaderClasses('e2ee_post_header e2ee__error');
    };

    useEffect(() => {
        let active = true;
        setPlaintext(null);
        if (privkey == null) {
            setMsgError('e2ee needs to be setup');
            return () => {
                active = false;
            };
        }
        const msgCached = msgCache.get(post);
        if (msgCached !== null) {
            setMsgSuccess(msgCached);
            return () => {
                active = false;
            };
        }

        setMsgText('');
        setPostClasses('e2ee_post_body e2ee_post_body__decrypting');
        const uid = post.user_id;
        actions.getPubKeys([uid]).

            // TODO: AG: see src/types.ts to see why we need to ignore the type
            // checker (cf. MyActionResult)
            // @ts-ignore
            then(({data: reskey, error}) => {
                if (!active) {
                    return;
                }
                if (error) {
                    throw error;
                }
                const senderkey = reskey.get(uid) || null;
                if (senderkey == null) {
                    throw new Error('it is unknown');
                }
                decryptPost(post.props.e2ee, senderkey, privkey).
                    then((decrMsg) => {
                        if (!active) {
                            return;
                        }
                        msgCache.addDecrypted(post, decrMsg);
                        setMsgSuccess(decrMsg);
                    }).
                    catch((e) => {
                        if (!active) {
                            return;
                        }
                        if (e instanceof E2EEUnknownRecipient) {
                            setMsgError("This message hasn't been encrypted for us");
                        } else {
                            setMsgError('Error while decrypting: ' + e.message);
                        }
                    });
            }).
            catch((e) => {
                if (active) {
                    setMsgError('Error while getting identity of sender: ' + e.message);
                }
            });
        return () => {
            active = false;
        };
    }, [post, privkey, actions]);

    return (
        <div className='e2ee_post'>
            <div className={headerClasses}>{'🔐'}</div>
            <div className='e2ee_post_content'>
                <div className={postClasses}>{msgText}</div>
                {privkey && plaintext !== null && post.user_id === currentUserID && (
                    <EncryptedEditor
                        post={post}
                        text={plaintext}
                        privkey={privkey}
                        getPubKeys={actions.getPubKeys}
                        onSaved={setMsgSuccess}
                    />
                )}
                <EncryptedAttachments
                    post={post}
                    privkey={privkey}
                    getPubKeys={actions.getPubKeys}
                />
            </div>
        </div>
    );
};

E2EEPost.propTypes = {

    // @ts-ignore
    post: PropTypes.object.isRequired,

    // @ts-ignore
    privkey: PropTypes.object.isRequired,

    currentUserID: PropTypes.string.isRequired,

    actions: {

        // @ts-ignore
        getPubKeys: PropTypes.func.isRequired,

        // @ts-ignore
        updatePost: PropTypes.func.isRequired,
    },
};
