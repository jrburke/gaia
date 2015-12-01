/**
 * @module
 */
define(function (require, exports) {
  'use strict';

  var logic = require('logic');
  // XXX proper logging configuration for the front-end too once things start
  // working happily.
  logic.realtimeLogEverything = true;

  // Use a relative link so that consumers do not need to create
  // special config to use main-frame-setup.
  const addressparser = require('./ext/addressparser');
  const evt = require('evt');

  const MailFolder = require('./clientapi/mail_folder');

  const MailConversation = require('./clientapi/mail_conversation');
  const MailMessage = require('./clientapi/mail_message');

  const ContactCache = require('./clientapi/contact_cache');
  const UndoableOperation = require('./clientapi/undoable_operation');

  const AccountsViewSlice = require('./clientapi/accounts_view_slice');
  const FoldersListView = require('./clientapi/folders_list_view');
  const ConversationsListView = require('./clientapi/conversations_list_view');
  const MessagesListView = require('./clientapi/messages_list_view');

  const MessageComposition = require('./clientapi/message_composition');

  const { accountIdFromConvId, accountIdFromMessageId, convIdFromMessageId } = require('./id_conversions');

  const Linkify = require('./clientapi/bodies/linkify');

  /**
   * Given a list of MailFolders (that may just be null and not a list), map those
   * to the folder id's.
   */
  var normalizeFoldersToIds = function (folders) {
    if (!folders) {
      return folders;
    }
    return folders.map(function (folder) {
      return folder.id;
    });
  };

  // For testing
  exports._MailFolder = MailFolder;

  const LEGAL_CONFIG_KEYS = ['debugLogging'];

  /**
   * The public API exposed to the client via the MailAPI global.
   *
   * TODO: Implement a failsafe timeout mechanism for returning Promises for
   * requests that will timeout and reject or something.  The idea is to allow
   * code that
   *
   * @constructor
   * @memberof module:mailapi
   */
  function MailAPI() {
    evt.Emitter.call(this);
    logic.defineScope(this, 'MailAPI', {});
    this._nextHandle = 1;

    /**
     * @type {Map<BridgeHandle, Object>}
     *
     * Holds live list views (what were formerly called slices) and live tracked
     * one-off items (ex: viewConversation/friends that call
     * _getItemAndTrackUpdates).
     *
     * In many ways this is nearly identically to _pendingRequests, but this was
     * split off because different semantics were originally intended.  Probably
     * it makes sense to keep this for "persistent subscriptions" and eventually
     * replace things using _pendingRequests with an explicitly supported
     * co.wrap() idiom.
     */
    this._trackedItemHandles = new Map();
    this._pendingRequests = {};
    this._liveBodies = {};

    // Store bridgeSend messages received before back end spawns.
    this._storedSends = [];

    this._processingMessage = null;
    /**
     * List of received messages whose processing is being deferred because we
     * still have a message that is actively being processed, as stored in
     * `_processingMessage`.
     */
    this._deferredMessages = [];

    /**
     * @dict[
     *   @key[debugLogging]
     *   @key[checkInterval]
     * ]{
     *   Configuration data.  This is currently populated by data from
     *   `MailUniverse.exposeConfigForClient` by the code that constructs us.  In
     *   the future, we will probably want to ask for this from the `MailUniverse`
     *   directly over the wire.
     *
     *   This should be treated as read-only.
     * }
     */
    this.config = {};

    /* PROPERLY DOCUMENT EVENT 'badlogin'
     * @func[
     *   @args[
     *     @param[account MailAccount]
     *   ]
     * ]{
     *   A callback invoked when we fail to login to an account and the server
     *   explicitly told us the login failed and we have no reason to suspect
     *   the login was temporarily disabled.
     *
     *   The account is put in a disabled/offline state until such time as the
     *
     * }
     */

    ContactCache.init();

    // Default slices:
    this.accounts = this.viewAccounts({ autoViewFolders: true });
  }
  exports.MailAPI = MailAPI;
  MailAPI.prototype = evt.mix( /** @lends module:mailapi.MailAPI.prototype */{
    toString: function () {
      return '[MailAPI]';
    },
    toJSON: function () {
      return { type: 'MailAPI' };
    },

    // This exposure as "utils" exists for legacy reasons right now, we should
    // probably just move consumers to directly require the module.
    utils: Linkify,

    eventuallyGetAccountById: function (accountId) {
      return this.accounts.eventuallyGetAccountById(accountId);
    },

    eventuallyGetFolderById: function (folderId) {
      var accountId = accountIdFromConvId(folderId);
      return this.accounts.eventuallyGetAccountById(accountId).then(function gotAccount(account) {
        console.log('got the account');
        return account.folders.eventuallyGetFolderById(folderId);
      }, function () {
        console.log('SOMEHOW REJECTED?!');
      });
    },

    /**
     * Convert the folder id's for a message into MailFolder instances by looking
     * them up from the account's folders list view.
     *
     * XXX deal with the potential asynchrony of this method being called before
     * the account is known to us.  We should generally be fine, but we don't have
     * the guards in place to actually protect us.
     */
    _mapLabels: function (messageId, folderIds) {
      var accountId = accountIdFromMessageId(messageId);
      var account = this.accounts.getAccountById(accountId);
      if (!account) {
        console.warn('the possible has happened; unable to find account with id', accountId);
      }
      var folders = account.folders;
      return Array.from(folderIds).map(function (folderId) {
        return folders.getFolderById(folderId);
      });
    },

    /**
     * Send a message over/to the bridge.  The idea is that we (can) communicate
     * with the backend using only a postMessage-style JSON channel.
     */
    __bridgeSend: function (msg) {
      // This method gets clobbered eventually once back end worker is ready.
      // Until then, it will store calls to send to the back end.

      this._storedSends.push(msg);
    },

    /**
     * Process a message received from the bridge.
     */
    __bridgeReceive: function (msg) {
      // Pong messages are used for tests
      if (this._processingMessage && msg.type !== 'pong') {
        logic(this, 'deferMessage', { type: msg.type });
        this._deferredMessages.push(msg);
      } else {
        logic(this, 'immediateProcess', { type: msg.type });
        this._processMessage(msg);
      }
    },

    _processMessage: function (msg) {
      var methodName = '_recv_' + msg.type;
      if (!(methodName in this)) {
        logic.fail(new Error('Unsupported message type:', msg.type));
        return;
      }
      try {
        logic(this, 'processMessage', { type: msg.type });
        var promise = this[methodName](msg);
        if (promise && promise.then) {
          this._processingMessage = promise;
          promise.then(this._doneProcessingMessage.bind(this, msg));
        }
      } catch (ex) {
        logic(this, 'processMessageError', {
          type: msg.type,
          ex,
          stack: ex.stack
        });
        return;
      }
    },

    _doneProcessingMessage: function (msg) {
      if (this._processingMessage && this._processingMessage !== msg) {
        throw new Error('Mismatched message completion!');
      }

      this._processingMessage = null;
      while (this._processingMessage === null && this._deferredMessages.length) {
        this._processMessage(this._deferredMessages.shift());
      }
    },

    /** @see ContactCache.shoddyAutocomplete */
    shoddyAutocomplete: function (phrase) {
      return ContactCache.shoddyAutocomplete(phrase);
    },

    /**
     * Return a promise that's resolved with a MailConversation instance that is
     * live-updating with events until `release` is called on it.
     */
    getConversation: function (conversationId, priorityTags) {
      var _this = this;

      // We need the account for the conversation in question to be loaded for
      // safety, dependency reasons.
      return this.eventuallyGetAccountById(accountIdFromConvId(conversationId)).then(function () {
        // account is ignored, we just needed to ensure it existed for
        // _mapLabels to be a friendly, happy, synchronous API.
        return _this._getItemAndTrackUpdates('conv', conversationId, MailConversation, priorityTags);
      });
    },

    /**
     * Return a promise that's resolved with a MailMessage instance that is
     * live-updating with events until `release` is called on it.
     *
     * @param {[MessageId, DateMS]} messageNamer
     */
    getMessage: function (messageNamer, priorityTags) {
      var _this2 = this;

      var messageId = messageNamer[0];
      // We need the account for the conversation in question to be loaded for
      // safety, dependency reasons.
      return this.eventuallyGetAccountById(accountIdFromMessageId(messageId)).then(function () {
        // account is ignored, we just needed to ensure it existed for
        // _mapLabels to be a friendly, happy, synchronous API.
        return _this2._getItemAndTrackUpdates('msg', messageNamer, MailMessage, priorityTags);
      });
    },

    /**
     * Sends a message with a freshly allocated single-use handle, returning a
     * Promise that will be resolved when the MailBridge responds to the message.
     * (Someday it may also be rejected if we lose the back-end.)
     */
    _sendPromisedRequest: function (sendMsg) {
      var _this3 = this;

      return new Promise(function (resolve) {
        var handle = sendMsg.handle = _this3._nextHandle++;
        _this3._pendingRequests[handle] = {
          type: sendMsg.type,
          resolve
        };
        _this3.__bridgeSend(sendMsg);
      });
    },

    _recv_promisedResult: function (msg) {
      var handle = msg.handle;
      var pending = this._pendingRequests[handle];
      delete this._pendingRequests[handle];
      pending.resolve(msg.data);
    },

    _recv_broadcast: function (msg) {
      var { name, data } = msg.payload;
      this.emit(name, data);
    },

    /**
     * Ask the back-end for an item by its id.  The current state will be loaded
     * from the db and then logically consistent updates provided until release
     * is called on the object.
     *
     * In the future we may support also taking an existing wireRep so that the
     * object can be provided synchronously.  I want to try to avoid that at first
     * because it's the type of thing that really wants to be implemented when
     * we've got our unit tests stood up again.
     *
     * `_cleanupContext` should be invoked by the release method of whatever
     * object we create when all done.
     *
     * XXX there's a serious potential for resource-leak/clobbering races where by
     * the time we resolve our promise the caller will not correctly call release
     * on our value or we'll end up clobbering the value from a chronologically
     * later call to our method.
     */
    _getItemAndTrackUpdates: function (itemType, itemId, itemConstructor, priorityTags) {
      var _this4 = this;

      return new Promise(function (resolve, reject) {
        var handle = _this4._nextHandle++;
        _this4._trackedItemHandles.set(handle, {
          type: itemType,
          id: itemId,
          callback: function (msg) {
            if (msg.error || !msg.data) {
              reject(new Error('track problem, error: ' + msg.error + ' has data?: ' + !!msg.data));
              return;
            }

            var obj = new itemConstructor(_this4, msg.data.state, msg.data.overlays, null, handle);
            resolve(obj);
            _this4._trackedItemHandles.set(handle, {
              type: itemType,
              id: itemId,
              obj: obj
            });
          }
        });
        _this4.__bridgeSend({
          type: 'getItemAndTrackUpdates',
          handle: handle,
          itemType: itemType,
          itemId: itemId,
          priorityTags
        });
        return handle;
      });
    },

    _recv_gotItemNowTrackingUpdates: function (msg) {
      var details = this._trackedItemHandles.get(msg.handle);
      details.callback(msg);
    },

    /**
     * Internal-only API to update the priority associated with an instantiated
     * object.
     */
    _updateTrackedItemPriorityTags: function (handle, priorityTags) {
      this.__bridgeSend({
        type: 'updateTrackedItemPriorityTags',
        handle: handle,
        priorityTags: priorityTags
      });
    },

    // update event for list views.  This used to be shared logic with updateItem
    // but when overlays came into the picture the divergence got too crazy.
    _recv_update: function (msg) {
      var details = this._trackedItemHandles.get(msg.handle);
      if (details && details.obj) {
        var obj = details.obj;

        var data = msg.data;
        obj.__update(data);
      }
    },

    // update event for tracked items (rather than list views)
    _recv_updateItem: function (msg) {
      var details = this._trackedItemHandles.get(msg.handle);
      if (details && details.obj) {
        var obj = details.obj;

        var data = msg.data;
        if (data === null) {
          // - null means removal
          // TODO: consider whether our semantics should be self-releasing in this
          // case.  For now we will leave it up to the caller.
          obj.emit('remove', obj);
        } else {
          // - non-null means it's an update!
          if (data.state) {
            obj.__update(data.state);
          }
          if (data.overlays) {
            obj.__updateOverlays(data.overlays);
          }
          obj.serial++;
          obj.emit('change', obj);
        }
      }
    },

    _cleanupContext: function (handle) {
      this.__bridgeSend({
        type: 'cleanupContext',
        handle: handle
      });
    },

    /**
     * The mailbridge response to a "cleanupContext" command, triggered by a call
     * to our sibling `_cleanupContext` function which should be invoked by public
     * `release` calls.
     *
     * TODO: Conclusively decide whether it could make sense for this, or a
     * variant of this for cases where the mailbridge/backend can send effectively
     * unsolicited notifications of this.
     */
    _recv_contextCleanedUp: function (msg) {
      this._trackedItemHandles.delete(msg.handle);
    },

    _downloadBodyReps: function (messageId, messageDate) {
      this.__bridgeSend({
        type: 'downloadBodyReps',
        id: messageId,
        date: messageDate
      });
    },

    _downloadAttachments: function (downloadReq) {
      return this._sendPromisedRequest({
        type: 'downloadAttachments',
        downloadReq
      });
    },

    /**
     * Given a user's email address, try and see if we can autoconfigure the
     * account and what information we'll need to configure it, specifically
     * a password or if XOAuth2 credentials will be needed.
     *
     * @param {Object} details
     * @param {String} details.emailAddress
     *   The user's email address.
     * @return {Promise<Object>}
     *   A promise that will be resolved with an object like so:
     *
     *   No autoconfig information is available and the user has to do manual
     *   setup:
     *
     *     {
     *       result: 'no-config-info',
     *       configInfo: null
     *     }
     *
     *   Autoconfig information is available and to complete the autoconfig
     *   we need the user's password.  For IMAP and POP3 this means we know
     *   everything we need and can actually create the account.  For ActiveSync
     *   we actually need the password to try and perform autodiscovery.
     *
     *     {
     *       result: 'need-password',
     *       configInfo: { incoming, outgoing }
     *     }
     *
     *   Autoconfig information is available and XOAuth2 authentication should
     *   be attempted and those credentials then provided to us.
     *
     *     {
     *       result: 'need-oauth2',
     *       configInfo: {
     *         incoming,
     *         outgoing,
     *         oauth2Settings: {
     *           secretGroup: 'google' or 'microsoft' or other arbitrary string,
     *           authEndpoint: 'url to the auth endpoint',
     *           tokenEndpoint: 'url to where you ask for tokens',
     *           scope: 'space delimited list of scopes to request'
     *         }
     *       }
     *     }
     *
     *   A `source` property will also be present in the result object.  Its
     *   value will be one of: 'hardcoded', 'local', 'ispdb',
     *   'autoconfig-subdomain', 'autoconfig-wellknown', 'mx local', 'mx ispdb',
     *   'autodiscover'.
     */
    learnAboutAccount: function (details) {
      return this._sendPromisedRequest({
        type: 'learnAboutAccount',
        details
      });
    },

    /**
     * Try to create an account.  There is currently no way to abort the process
     * of creating an account.  You really want to use learnAboutAccount before
     * you call this unless you are an automated test.
     *
     * @typedef[AccountCreationError @oneof[
     *   @case['offline']{
     *     We are offline and have no network access to try and create the
     *     account.
     *   }
     *   @case['no-dns-entry']{
     *     We couldn't find the domain name in question, full stop.
     *
     *     Not currently generated; eventually desired because it suggests a typo
     *     and so a specialized error message is useful.
     *   }
     *   @case['no-config-info']{
     *     We were unable to locate configuration information for the domain.
     *   }
     *   @case['unresponsive-server']{
     *     Requests to the server timed out.  AKA we sent packets into a black
     *     hole.
     *   }
     *   @case['port-not-listening']{
     *     Attempts to connect to the given port on the server failed.  We got
     *     packets back rejecting our connection.
     *
     *     Not currently generated; primarily desired because it is very useful if
     *     we are domain guessing.  Also desirable for error messages because it
     *     suggests a user typo or the less likely server outage.
     *   }
     *   @case['bad-security']{
     *     We were able to connect to the port and initiate TLS, but we didn't
     *     like what we found.  This could be a mismatch on the server domain,
     *     a self-signed or otherwise invalid certificate, insufficient crypto,
     *     or a vulnerable server implementation.
     *   }
     *   @case['bad-user-or-pass']{
     *     The username and password didn't check out.  We don't know which one
     *     is wrong, just that one of them is wrong.
     *   }
     *   @case['bad-address']{
     *     The e-mail address provided was rejected by the SMTP probe.
     *   }
     *   @case['pop-server-not-great']{
     *     The POP3 server doesn't support IDLE and TOP, so we can't use it.
     *   }
     *   @case['imap-disabled']{
     *     IMAP support is not enabled for the Gmail account in use.
     *   }
     *   @case['pop3-disabled']{
     *     POP3 support is not enabled for the Gmail account in use.
     *   }
     *   @case['needs-oauth-reauth']{
     *     The OAUTH refresh token was invalid, or there was some problem with
     *     the OAUTH credentials provided. The user needs to go through the
     *     OAUTH flow again.
     *   }
     *   @case['not-authorized']{
     *     The username and password are correct, but the user isn't allowed to
     *     access the mail server.
     *   }
     *   @case['server-problem']{
     *     We were able to talk to the "server" named in the details object, but
     *     we encountered some type of problem.  The details object will also
     *     include a "status" value.
     *   }
     *   @case['server-maintenance']{
     *     The server appears to be undergoing maintenance, at least for this
     *     account.  We infer this if the server is telling us that login is
     *     disabled in general or when we try and login the message provides
     *     positive indications of some type of maintenance rather than a
     *     generic error string.
     *   }
     *   @case['user-account-exists']{
     *     If the user tries to create an account which is already configured.
     *     Should not be created. We will show that account is already configured
     *   }
     *   @case['unknown']{
     *     We don't know what happened; count this as our bug for not knowing.
     *   }
     *   @case[null]{
     *     No error, the account was created and everything is terrific.
     *   }
     * ]]
     *
     * @param {Object} details
     * @param {String} details.emailAddress
     * @param {String} [details.password]
     *   The user's password
     * @param {Object} [configInfo]
     *   If continuing an autoconfig initiated by learnAboutAccount, the
     *   configInfo it returned as part of its results, although you will need
     *   to poke the following structured properties in if you're doing the oauth2
     *   thing:
     *
     *     {
     *       oauth2Secrets: { clientId, clientSecret }
     *       oauth2Tokens: { accessToken, refreshToken, expireTimeMS }
     *     }
     *
     *   If performing a manual config, a manually created configInfo object of
     *   the following form:
     *
     *     {
     *       incoming: { hostname, port, socketType, username, password }
     *       outgoing: { hostname, port, socketType, username, password }
     *     }
     *
     *
     *
     * @param {Function} callback
     *   The callback to invoke upon success or failure.  The callback will be
     *   called with 2 arguments in the case of failure: the error string code,
     *   and the error details object.
     *
     *
     * @args[
     *   @param[details @dict[
     *     @key[displayName String]{
     *       The name the (human, per EULA) user wants to be known to the world
     *       as.
     *     }
     *     @key[emailAddress String]
     *     @key[password String]
     *   ]]
     *   @param[callback @func[
     *     @args[
     *       @param[error AccountCreationError]
     *       @param[errorDetails @dict[
     *         @key[server #:optional String]{
     *           The server we had trouble talking to.
     *         }
     *         @key[status #:optional @oneof[Number String]]{
     *           The HTTP status code number, or "timeout", or something otherwise
     *           providing detailed additional information about the error.  This
     *           is usually too technical to be presented to the user, but is
     *           worth encoding with the error name proper if possible.
     *         }
     *       ]]
     *     ]
     *   ]
     * ]
     */
    tryToCreateAccount: function (userDetails, domainInfo) {
      var _this5 = this;

      return this._sendPromisedRequest({
        type: 'tryToCreateAccount',
        userDetails,
        domainInfo
      }).then(function (result) {
        if (result.accountId) {
          return _this5.accounts.eventuallyGetAccountById(result.accountId).then(function (account) {
            return {
              error: null,
              errorDetails: null,
              account
            };
          });
        } else {
          return {
            error: result.error,
            errorDetails: result.errorDetails
          };
        }
      });
    },

    _clearAccountProblems: function ma__clearAccountProblems(account, callback) {
      var handle = this._nextHandle++;
      this._pendingRequests[handle] = {
        type: 'clearAccountProblems',
        callback: callback
      };
      this.__bridgeSend({
        type: 'clearAccountProblems',
        accountId: account.id,
        handle: handle
      });
    },

    _recv_clearAccountProblems: function ma__recv_clearAccountProblems(msg) {
      var req = this._pendingRequests[msg.handle];
      delete this._pendingRequests[msg.handle];
      req.callback && req.callback();
    },

    _modifyAccount: function (account, mods) {
      return this._sendPromisedRequest({
        type: 'modifyAccount',
        accountId: account.id,
        mods
      }).then(function () {
        return null;
      });
    },

    _recreateAccount: function (account) {
      this.__bridgeSend({
        type: 'recreateAccount',
        accountId: account.id
      });
    },

    _deleteAccount: function (account) {
      this.__bridgeSend({
        type: 'deleteAccount',
        accountId: account.id
      });
    },

    _modifyIdentity: function (identity, mods) {
      return this._sendPromisedRequest({
        type: 'modifyIdentity',
        identityId: identity.id,
        mods
      }).then(function () {
        return null;
      });
    },

    /**
     * Get the list of accounts.  This can be used for the list of accounts in
     * setttings or for a folder tree where only one account's folders are visible
     * at a time.
     *
     * @param {Object} [opts]
     * @param {Boolean} [opts.autoViewFolders=false]
     *   Should the `MailAccount` instances automatically issue viewFolders
     *   requests and assign them to a "folders" property?
     */
    viewAccounts: function (opts) {
      var handle = this._nextHandle++,
          view = new AccountsViewSlice(this, handle, opts);
      this._trackedItemHandles.set(handle, { obj: view });

      this.__bridgeSend({
        type: 'viewAccounts',
        handle: handle
      });
      return view;
    },

    /**
     * Retrieve the entire folder hierarchy for either 'navigation' (pick what
     * folder to show the contents of, including unified folders), 'movetarget'
     * (pick target folder for moves, does not include unified folders), or
     * 'account' (only show the folders belonging to a given account, implies
     * selection).  In all cases, there may exist non-selectable folders such as
     * the account roots or IMAP folders that cannot contain messages.
     *
     * When accounts are presented as folders via this UI, they do not expose any
     * of their `MailAccount` semantics.
     *
     * @args[
     *   @param[mode @oneof['navigation' 'movetarget' 'account']
     *   @param[argument #:optional]{
     *     Arguent appropriate to the mode; currently will only be a `MailAccount`
     *     instance.
     *   }
     * ]
     */
    viewFolders: function (mode, accountId) {
      var handle = this._nextHandle++,
          view = new FoldersListView(this, handle);

      this._trackedItemHandles.set(handle, { obj: view });

      this.__bridgeSend({
        type: 'viewFolders',
        mode: mode,
        handle: handle,
        accountId: accountId
      });

      return view;
    },

    /**
     * View the conversations in a folder.
     */
    viewFolderConversations: function (folder) {
      var handle = this._nextHandle++,
          view = new ConversationsListView(this, handle);
      view.folderId = folder.id;
      this._trackedItemHandles.set(handle, { obj: view });

      this.__bridgeSend({
        type: 'viewFolderConversations',
        folderId: folder.id,
        handle: handle
      });

      return view;
    },

    viewConversationMessages: function (convOrId) {
      var handle = this._nextHandle++,
          view = new MessagesListView(this, handle);
      view.conversationId = typeof convOrId === 'string' ? convOrId : convOrId.id;
      this._trackedItemHandles.set(handle, { obj: view });

      this.__bridgeSend({
        type: 'viewConversationMessages',
        conversationId: view.conversationId,
        handle: handle
      });

      return view;
    },

    /**
     * Search a folder for messages containing the given text in the sender,
     * recipients, or subject fields, as well as (optionally), the body with a
     * default time constraint so we don't entirely kill the server or us.
     *
     * @args[
     *   @param[folder]{
     *     The folder whose messages we should search.
     *   }
     *   @param[text]{
     *     The phrase to search for.  We don't split this up into words or
     *     anything like that.  We just do straight-up indexOf on the whole thing.
     *   }
     *   @param[whatToSearch @dict[
     *     @key[author #:optional Boolean]
     *     @key[recipients #:optional Boolean]
     *     @key[subject #:optional Boolean]
     *     @key[body #:optional @oneof[false 'no-quotes' 'yes-quotes']]
     *   ]]
     * ]
     */
    searchFolderMessages: function (folder, text, whatToSearch) {
      // XXX OLD
    },

    //////////////////////////////////////////////////////////////////////////////
    // Batch Message Mutation
    //
    // If you want to modify a single message, you can use the methods on it
    // directly.
    //
    // All actions are undoable and return an `UndoableOperation`.

    deleteMessages: function ma_deleteMessages(messages) {
      // We allocate a handle that provides a temporary name for our undoable
      // operation until we hear back from the other side about it.
      var handle = this._nextHandle++;

      var undoableOp = new UndoableOperation(this, 'delete', messages.length, handle),
          msgSuids = messages.map(function (x) {
        return x.id;
      });

      this._pendingRequests[handle] = {
        type: 'mutation',
        handle: handle,
        undoableOp: undoableOp
      };
      this.__bridgeSend({
        type: 'deleteMessages',
        handle: handle,
        messages: msgSuids
      });

      return undoableOp;
    },

    // Copying messages is not required yet.
    /*
    copyMessages: function ma_copyMessages(messages, targetFolder) {
    },
    */

    moveMessages: function ma_moveMessages(messages, targetFolder, callback) {
      // We allocate a handle that provides a temporary name for our undoable
      // operation until we hear back from the other side about it.
      var handle = this._nextHandle++;

      var undoableOp = new UndoableOperation(this, 'move', messages.length, handle),
          msgSuids = messages.map(function (x) {
        return x.id;
      });

      this._pendingRequests[handle] = {
        type: 'mutation',
        handle: handle,
        undoableOp: undoableOp,
        callback: callback
      };
      this.__bridgeSend({
        type: 'moveMessages',
        handle: handle,
        messages: msgSuids,
        targetFolder: targetFolder.id
      });

      return undoableOp;
    },

    markMessagesRead: function ma_markMessagesRead(messages, beRead) {
      return this.modifyMessageTags(messages, beRead ? ['\\Seen'] : null, beRead ? null : ['\\Seen'], beRead ? 'read' : 'unread');
    },

    markMessagesStarred: function ma_markMessagesStarred(messages, beStarred) {
      return this.modifyMessageTags(messages, beStarred ? ['\\Flagged'] : null, beStarred ? null : ['\\Flagged'], beStarred ? 'star' : 'unstar');
    },

    /**
     * Add/remove labels on all the messages in conversation(s) at once.  If you
     * want to only manipulate the labels on some of the messages, use
     * `modifyConversationMessageLabels`.
     *
     * Note that the back-end is smart and won't do redundant things; so you
     * need not attempt to be clever.
     *
     * TODO: undo support
     *
     * @param {MailConversation[]} conversations
     * @param {MailFolder[]} [addLabels]
     * @param {MailFolder[]} [removeLabels]
     * @param {"last"|null} messageSelector
     *   Allows filtering the set of affected messages in the conversation.
     */
    modifyConversationLabels: function (conversations, addLabels, removeLabels, messageSelector) {
      this.__bridgeSend({
        type: 'store_labels',
        conversations: conversations.map(function (x) {
          return {
            id: x.id,
            messageSelector
          };
        }),
        add: normalizeFoldersToIds(addLabels),
        remove: normalizeFoldersToIds(removeLabels)
      });
    },

    /**
     * Add/remove labels on specific messages within a conversation.  All of the
     * messages you pass to this method must be from a single conversation.  If
     * you want to manipulate all of the messages in the conversation, use
     * `modifyConversationLabels`, not this method.
     *
     * TODO: undo support
     */
    modifyConversationMessageLabels: function (messages, addLabels, removeLabels) {
      this.__bridgeSend({
        type: 'store_labels',
        conversations: [{
          id: convIdFromMessageId(messages[0].id),
          messageIds: messages.map(function (x) {
            return x.id;
          })
        }],
        add: normalizeFoldersToIds(addLabels),
        remove: normalizeFoldersToIds(removeLabels)
      });
    },

    modifyConversationTags: function (conversations, addTags, removeTags, messageSelector) {
      this.__bridgeSend({
        type: 'store_flags',
        conversations: conversations.map(function (x) {
          return {
            id: x.id,
            messageSelector
          };
        }),
        add: addTags,
        remove: removeTags
      });
    },

    modifyMessageTags: function ma_modifyMessageTags(messages, addTags, removeTags, _opcode) {
      this.__bridgeSend({
        type: 'store_flags',
        conversations: [{
          id: convIdFromMessageId(messages[0].id),
          messageIds: messages.map(function (x) {
            return x.id;
          })
        }],
        add: addTags,
        remove: removeTags
      });
    },

    /**
     * Check the outbox for pending messages, and initiate a series of
     * jobs to attempt to send them. The callback fires after the first
     * message's send attempt completes; this job will then
     * self-schedule further jobs to attempt to send the rest of the
     * outbox.
     *
     * @param {MailAccount} account
     * @param {function} callback
     *   Called after the first message's send attempt finishes.
     */
    sendOutboxMessages: function (account, callback) {
      // the revised complex task is pretty smart; not sure to what extent we need
      // this.  we may need to revisit semantics somewhat, since this is mainly
      // about moving deferred tasks immediately back into the "go" bucket and
      // maybe re-scheduling drafts we had given up on.
      // TODO: clear up what to do here.
    },

    /**
     * Enable or disable outbox syncing for this account. This is
     * generally a temporary measure, used when the user is actively
     * editing the list of outbox messages and we don't want to
     * inadvertently move something out from under them. This change
     * does _not_ persist; it's meant to be used only for brief periods
     * of time, not as a "sync schedule" coordinator.
     */
    setOutboxSyncEnabled: function (account, enabled) {
      return this._sendPromisedRequest({
        type: 'outboxSetPaused',
        accountId: account.id,
        bePaused: !enabled
      }); // (the bridge sends null for the data, which is what gets resolved)
    },

    /**
     * Parse a structured email address
     * into a display name and email address parts.
     * It will return null on a parse failure.
     *
     * @param {String} email A email address.
     * @return {Object} An object of the form { name, address }.
     */
    parseMailbox: function (email) {
      try {
        var mailbox = addressparser.parse(email);
        return mailbox.length >= 1 ? mailbox[0] : null;
      } catch (ex) {
        return null;
      }
    },

    __undo: function undo(undoableOp) {
      this.__bridgeSend({
        type: 'undo',
        longtermIds: undoableOp._longtermIds
      });
    },

    //////////////////////////////////////////////////////////////////////////////
    // Contact Support

    resolveEmailAddressToPeep: function (emailAddress, callback) {
      var peep = ContactCache.resolvePeep({ name: null, address: emailAddress });
      if (ContactCache.pendingLookupCount) {
        ContactCache.callbacks.push(callback.bind(null, peep));
      } else {
        callback(peep);
      }
    },

    //////////////////////////////////////////////////////////////////////////////
    // Message Composition

    /**
     * Begin the message composition process, creating a MessageComposition that
     * stores the current message state and periodically persists its state to the
     * backend so that the message is potentially available to other clients and
     * recoverable in the event of a local crash.
     *
     * Composition is triggered in the context of a given message and folder so
     * that the correct account and sender identity for composition can be
     * inferred.  Message may be null if there are no messages in the folder.
     * Folder is not required if a message is provided.
     *
     * @param {MailMessage} message
     * @param {MailFolder} folder
     * @param {Object} options
     * @param {'blank'|'reply'|'forward'} options.command
     * @param {'sender'|'all'} options.mode
     *   The reply mode.  This will eventually indicate the forwarding mode too.
     * @param {Boolean} [options.noComposer=false]
     *   Don't actually want the MessageComposition instance created for you?
     *   Pass true for this.  You can always call resumeMessageComposition
     *   yourself; that's all we do anyways.
     * @return {Promise<MessageComposition>}
     *   A MessageComposition instance populated for use.  You need to call
     *   release on it when you are done.
     */
    beginMessageComposition: function (message, folder, options) {
      var _this6 = this;

      if (!options) {
        options = {};
      }
      return this._sendPromisedRequest({
        type: 'createDraft',
        draftType: options.command,
        mode: options.mode,
        refMessageId: message ? message.id : null,
        refMessageDate: message ? message.date.valueOf() : null,
        folderId: folder ? folder.id : null
      }).then(function (data) {
        var namer = { id: data.messageId, date: data.messageDate };
        if (options.noComposer) {
          return namer;
        } else {
          return _this6.resumeMessageComposition(namer);
        }
      });
    },

    /**
     * Open a message as if it were a draft message (hopefully it is), returning
     * a Promise that will be resolved with a fully valid MessageComposition
     * object.  You will need to call release
     *
     * @param {MailMessage|MessageObjNamer} namer
     */
    resumeMessageComposition: function (namer) {
      var _this7 = this;

      return this.getMessage([namer.id, namer.date.valueOf()]).then(function (msg) {
        var composer = new MessageComposition(_this7);
        return composer.__asyncInitFromMessage(msg);
      });
    },

    _composeAttach: function (messageId, attachmentDef) {
      this.__bridgeSend({
        type: 'attachBlobToDraft',
        messageId,
        attachmentDef
      });
    },

    _composeDetach: function (messageId, attachmentRelId) {
      this.__bridgeSend({
        type: 'detachAttachmentFromDraft',
        messageId,
        attachmentRelId
      });
    },

    _composeDone: function (messageId, command, draftFields) {
      return this._sendPromisedRequest({
        type: 'doneCompose',
        messageId, command, draftFields
      });
    },

    //////////////////////////////////////////////////////////////////////////////
    // mode setting for back end universe. Set interactive
    // if the user has been exposed to the UI and it is a
    // longer lived application, not just a cron sync.
    setInteractive: function () {
      this.__bridgeSend({
        type: 'setInteractive'
      });
    },

    //////////////////////////////////////////////////////////////////////////////
    // Localization

    /**
     * Provide a list of localized strings for use in message composition.  This
     * should be a dictionary with the following values, with their expected
     * default values for English provided.  Try to avoid being clever and instead
     * just pick the same strings Thunderbird uses for these for the given locale.
     *
     * - wrote: "{{name}} wrote".  Used for the lead-in to the quoted message.
     * - originalMessage: "Original Message".  Gets put between a bunch of dashes
     *    when forwarding a message inline.
     * - forwardHeaderLabels:
     *   - subject
     *   - date
     *   - from
     *   - replyTo (for the "reply-to" header)
     *   - to
     *   - cc
     */
    useLocalizedStrings: function (strings) {
      this.__bridgeSend({
        type: 'localizedStrings',
        strings: strings
      });
      if (strings.folderNames) {
        this.l10n_folder_names = strings.folderNames;
      }
    },

    /**
     * L10n strings for folder names.  These map folder types to appropriate
     * localized strings.
     *
     * We don't remap unknown types, so this doesn't need defaults.
     */
    l10n_folder_names: {},

    l10n_folder_name: function (name, type) {
      if (this.l10n_folder_names.hasOwnProperty(type)) {
        var lowerName = name.toLowerCase();
        // Many of the names are the same as the type, but not all.
        if (type === lowerName || type === 'drafts' || type === 'junk' || type === 'queue') {
          return this.l10n_folder_names[type];
        }
      }
      return name;
    },

    //////////////////////////////////////////////////////////////////////////////
    // Configuration

    /**
     * Change one-or-more backend-wide settings; use `MailAccount.modifyAccount`
     * to chang per-account settings.
     */
    modifyConfig: function (mods) {
      for (var key in mods) {
        if (LEGAL_CONFIG_KEYS.indexOf(key) === -1) {
          throw new Error(key + ' is not a legal config key!');
        }
      }
      return this._sendPromisedRequest({
        type: 'modifyConfig',
        mods
      }).then(function () {
        return null;
      });
    },

    _recv_config: function (msg) {
      this.config = msg.config;
    },

    //////////////////////////////////////////////////////////////////////////////
    // Diagnostics / Test Hacks

    /**
     * After a setZeroTimeout, send a 'ping' to the bridge which will send a
     * 'pong' back, notifying the provided callback.  This is intended to be hack
     * to provide a way to ensure that some function only runs after all of the
     * notifications have been received and processed by the back-end.
     *
     * Note that ping messages are always processed as they are received; they do
     * not get deferred like other messages.
     */
    ping: function (callback) {
      var handle = this._nextHandle++;
      this._pendingRequests[handle] = {
        type: 'ping',
        callback: callback
      };

      // With the introduction of slice batching, we now wait to send the ping.
      // This is reasonable because there are conceivable situations where the
      // caller really wants to wait until all related callbacks fire before
      // dispatching.  And the ping method is already a hack to ensure correctness
      // ordering that should be done using better/more specific methods, so this
      // change is not any less of a hack/evil, although it does cause misuse to
      // potentially be more capable of causing intermittent failures.
      window.setZeroTimeout((function () {
        this.__bridgeSend({
          type: 'ping',
          handle: handle
        });
      }).bind(this));
    },

    _recv_pong: function (msg) {
      var req = this._pendingRequests[msg.handle];
      delete this._pendingRequests[msg.handle];
      req.callback();
    },

    /**
     * Legacy means of setting the debug logging level.  Probably wants to go away
     * in favor of just using modifyConfig directly.  Other debugging-y stuff
     * probably will operate similarly or get its own explicit API calls.
     */
    debugSupport: function (command, argument) {
      if (command === 'setLogging') {
        this.config.debugLogging = argument;
        return this.modifyConfig({
          debugLogging: argument
        });
      } else if (command === 'dumpLog') {
        throw new Error('XXX circular logging currently not implemented');
      }
    },

    /**
     * Clear the set of new messages associated with the given account.  Also
     * exposed on MailAccount as clearNewTracking.
     */
    clearNewTrackingForAccount: function ({ account, accountId, silent }) {
      if (account && !accountId) {
        accountId = account.id;
      }
      this.__bridgeSend({
        type: 'clearNewTrackingForAccount',
        accountId,
        silent
      });
    },

    /**
     * Cause the 'newMessagesUpdate' message to be re-derived and re-broadcast.
     * This should only be used in exceptional circumstances because the whole
     * implementation of this assumes that persistent notifications are generated
     * by the broadcast.  Since the message will also automatically be sent when
     * the set of new messages changes, if you are calling this, you are by
     * definition asking for redundant data you should already have heard about.
     * I would prefix this with `debug` but it's possible there's a reason to
     * expose this that's not horrible.
     */
    flushNewAggregates: function () {
      this.__bridgeSend({
        type: 'flushNewAggregates'
      });
    },

    /**
     * Compel the backend to act like it received a cronsync.
     *
     * @param {AccountId[]} [arg.accountIds]
     *   The list of account ids to act like we are being told to sync.  If
     *   omitted, the list of all accounts is used.
     * @param {AccountId[]} [arg.notificationAccountIds]
     *   The list of account ids to act like we have outstanding notifications for
     *   (so as to not trigger a new_tracking status clearing).  If omitted, the
     *   list of all accounts is used.
     */
    debugForceCronSync: function ({ accountIds, notificationAccountIds }) {
      var allAccountIds = this.accounts.items.map(function (account) {
        return account.id;
      });

      if (!accountIds) {
        accountIds = allAccountIds;
      }
      if (!notificationAccountIds) {
        notificationAccountIds = allAccountIds;
      }
      this.__bridgeSend({
        type: 'debugForceCronSync',
        accountIds,
        notificationAccountIds
      });
    },

    /**
     * Retrieve the persisted-to-disk log entries we create for things like
     * cronsync.
     *
     * @return {Promise<Object[]>}
     */
    getPersistedLogs: function () {
      return this._sendPromisedRequest({
        type: 'getPersistedLogs'
      });
    }

    //////////////////////////////////////////////////////////////////////////////
  });
}); // end define
