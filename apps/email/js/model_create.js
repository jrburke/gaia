'use strict';
define(function(require) {
  var evt = require('evt'),
      // Expect a module to provide a function that allows setting up model/api
      // pieces that depend on specific UI or localizations.
      modelInit = require('model_init');

  function dieOnFatalError(msg) {
    console.error('FATAL:', msg);
    throw new Error(msg);
  }

  function saveHasAccount(accounts) {
    // Save localStorage value to improve startup choices
    localStorage.setItem('data_has_account',
                         (accounts.items.length ? 'yes' : 'no'));
    console.log('WRITING LOCAL STORAGE ITEM: ' + 'data_has_account',
                (accounts.items.length ? 'yes' : 'no'));
  }

/**
 * Provides a front end to the API and slice objects returned from the API.
 * Since the UI right now is driven by a shared set of slices, this module
 * tracks those slices and creates events when they are changed. This means
 * the card modules do not need a direct reference to each other to change
 * the backing data for a card, and that card modules and app logic do not
 * need a hard, static dependency on the MailAPI object. This allows some
 * more flexible and decoupled loading scenarios. In particular, cards can
 * be created an inserted into the DOM without needing the back end to
 * complete its startup and initialization.
 *
 * It mixes in 'evt' capabilities, so it will be common to see model
 * used with 'latest' and 'latestOnce' to get the latest model data
 * whenever it loads.
 *
 * Down the road, it may make sense to have more than one model object
 * in play. At that point, it may make sense to morph this into a
 * constructor function and then have the card objects receive a model
 * instance property for their model reference.
 *
 * @type {Object}
 */
  function Model() {
    evt.Emitter.call(this);
  }

  Model.prototype = {
    /**
    * accounts event is fired when the property changes.
    * event: accounts
    * @param {Object} the accounts object.
    **/
    accounts: null,

    /**
    * account event is fired when the property changes.
    * event: account
    * @param {Object} the account object.
    **/
    account: null,

    /**
    * folders event is fired when the property changes.
    * event: folders
    * @param {Object} the folders object.
    **/
    folders: null,

    /**
    * folder event is fired when the property changes.
    * event: folder
    * @param {Object} the folder object.
    **/
    folder: null,

    /**
     * emits an event based on a property value. Since the
     * event is based on a property value that is on this
     * object, *do not* use emitWhenListener, since, due to
     * the possibility of queuing old values with that
     * method, it could cause bad results (bug 971617), and
     * it is not needed since the latest* methods will get
     * the latest value on this object.
     * @param  {String} id event ID/property name
     */
    _callEmit: function(id) {
      this.emit(id, this[id]);
    },

    // Set to a promise that is resolved once all init has completed.
    inited: undefined,

    /**
     * Returns true if there is an account. Should only be
     * called after inited is resolved.
     */
    hasAccount: function() {
      return (this.getAccountCount() > 0);
    },

    /**
     * Given an account ID, get the account object. Only works once the
     * accounts property is available. Use model.latestOnce to get a
     * handle on an accounts property, then call this method.
     * @param  {String} id account ID.
     * @return {Object}    account object.
     */
    getAccount: function(id) {
      if (!this.accounts || !this.accounts.items) {
        throw new Error('No accounts available');
      }

      var targetAccount;
      this.accounts.items.some(function(account) {
        if (account.id === id) {
          return !!(targetAccount = account);
        }
      });

      return targetAccount;
    },

    /**
     * Get the numbers of configured account.
     * Should only be called after this.inited is resolved.
     * @return {Number} numbers of account.
     */
    getAccountCount: function() {
      var count = 0;

      if (this.accounts &&
          this.accounts.items &&
          this.accounts.items.length) {
        count = this.accounts.items.length;
      }

      return count;
    },

    //todo: revisit this logic. Ideally check a property on the account. This is
    //just a temporary measure to get the UI logic sorted out.
    accountUsesArchive: function() {
      // tried using firstFolder.syncGranularity === 'account', but it is not
      // set in time for the first time this called.
      return this.account.username.indexOf('@gmail.com') !== -1;
    },

    /**
     * Call this to initialize the model. It is *not* called by default in this
     * module to allow for lazy startup, and for cases like unit tests that may
     * not want to trigger a full model creation for a simple UI test.
     */
    init: function() {
      if (this.inited) {
        return this.inited;
      }

      return (this.inited = new Promise((resolve, reject) => {
        require(['api'], (api) => {
          // Multiple model instances can be created, but only one init needs
          // to be done with the backend API.
          if (this === modelCreate.defaultModel) {
            modelInit(this, api);
          }

          // Once the API/worker has started up and we have received account
          // data, consider the app fully loaded: we have verified full flow
          // of data from front to back.
          if (this === modelCreate.defaultModel) {
            evt.emitWhenListener('metrics:apiDone');
          }

          var accounts = api.accounts;

          var onComplete = () => {
            // Wait for all folder lists to load. If no accounts, still works
            // out to fall through to the then.
            Promise.all(accounts.items.map((account) => {
              var folders = account.folders;
              if (folders.complete) {
                return Promise.resolve();
              } else {
                return new Promise((resolve) => {
                  folders.once('complete', resolve);
                });
              }
            })).then(() => {
              this.api = api;
              this.accounts = accounts;
              saveHasAccount(accounts);

              var defaultAccount = accounts.defaultAccount;
              if (defaultAccount) {
                this.changeAccount(defaultAccount);
              }

              this._callEmit('api');
              this._callEmit('accounts');

              resolve(api);
            });
          };

          if (accounts.complete) {
            onComplete();
          } else {
            accounts.once('complete', onComplete);
          }
        }, reject);
      }).then((api) => {
        // Listen for changes in 'complete' status and update the cache value.
        api.accounts.on('complete', (accounts) => {
          saveHasAccount(accounts);

          // Emit again for accounts since it changed.
          this._callEmit('accounts');
        });

        return api;
      }));
    },

    /**
     * Changes the current account tracked by the model. This results
     * in changes to the 'account' and 'folder' properties.
     * @param  {Object}   account  the account object.
     * @return  {Promise} resolved to account after account has been changed.
     */
    changeAccount: function(account) {
      // Do not bother if account is the same.
      if (!this.account || this.account.id !== account.id) {
        this.reset();
        this.account = account;
        this._callEmit('account');

        var onFoldersComplete = (folders) => {
          this.folders = account.folders;
          this._callEmit('folders');
          this.selectInbox();
        };

        if (account.folders.complete) {
          onFoldersComplete();
        } else {
          account.folders.once('complete', this, onFoldersComplete);
        }
      }

      return this.account;
    },

    /**
     * Given an account ID, change the current account to that account.
     * @param  {String} accountId
     * @return {MailAccount} the account.
     */
    changeAccountFromId: function(accountId) {
      if (!this.accounts || !this.accounts.items.length) {
        throw new Error('No accounts available');
      }

      var newAccount;
      this.accounts.items.some((account) => {
        if (account.id === accountId) {
          newAccount = this.changeAccount(account);
          return true;
        }
      });

      return newAccount;
    },

    getFolder: function(folderId) {
      var items = this.folders.items;
      var folder;
      items.some(function(f) {
        if (f.id === folderId) {
          folder = f;
          return true;
        }
      });

      return folder;
    },

    /**
     * Just changes the folder property tracked by the model.
     * Assumes the folder still belongs to the currently tracked
     * account. It also does not result in any state changes or
     * event emitting if the new folder is the same as the
     * currently tracked folder.
     * @param  {Object} folder the folder object to use.
     */
    changeFolder: function(folder) {
      if (folder && (!this.folder || folder.id !== this.folder.id)) {
        if (this.folder) {
          this.folder.removeObjectListener(this);
        }

        this.folder = folder;
        this.folder.on('change', this, 'emitFolderChanged');
        this.folder.on('complete', this, 'emitFolderChanged');
        this._callEmit('folder');
      }
      return this.folder;
    },

    emitFolderChanged: function() {
      this.emit('folderUpdated', this.folder);
    },

    /**
     * For the already loaded account and associated folders,
     * set the inbox as the tracked 'folder'.
     */
    selectInbox: function() {
      return this.selectFirstFolderWithType('inbox');
    },

    /**
     * For the already loaded account and associated folders, set
     * the given folder as the tracked folder. The account MUST have a
     * folder with the given type, or a fatal error will occur.
     */
    selectFirstFolderWithType: function(folderType) {
      if (!this.account) {
        throw new Error('No account selected');
      }

      var folder = this.account.folders.getFirstFolderWithType(folderType);
      if (!folder) {
        dieOnFatalError('We have an account without a folderType ' +
                        folderType + '!', this.account.folders.items);
      }

      if (this.folder && this.folder.id === folder.id) {
        return this.folder;
      } else {
        return this.changeFolder(folder);
      }
    },

    /**
     * Called by other code when it knows the current account
     * has received new inbox messages. Just triggers an
     * event with the count for now.
     * @param  {Object} accountUpdate update object from
     * sync.js accountResults object structure.
     */
    notifyInboxMessages: function(accountUpdate) {
      if (accountUpdate.id === this.account.id) {
        this.emit('newInboxMessages', accountUpdate.count);
      }
    },

    notifyBackgroundSendStatus: function(data) {
      this.emit('backgroundSendStatus', data);
    },

    // Lifecycle
    reset: function() {
      this.account = null;
      this.folder = null;
      if (this.folders) {
        this.folders.removeObjectListener(this);
        this.folders = null;
      }
    }
  };

  evt.mix(Model.prototype);

  function modelCreate() {
    return new Model();
  }

  // Create a default one that can be used by setup code that does not need a
  // specific model instance, just one that should be used by default.
  modelCreate.defaultModel = new Model();

  return modelCreate;
});
