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

  function saveHasAccount(acctsSlice) {
    // Save localStorage value to improve startup choices
    localStorage.setItem('data_has_account',
                         (acctsSlice.items.length ? 'yes' : 'no'));

    console.log('WRITING LOCAL STORAGE ITEM: ' + 'data_has_account',
                (acctsSlice.items.length ? 'yes' : 'no'));
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
    * acctsSlice event is fired when the property changes.
    * event: acctsSlice
    * @param {Object} the acctsSlice object.
    **/
    acctsSlice: null,

    /**
    * account event is fired when the property changes.
    * event: account
    * @param {Object} the account object.
    **/
    account: null,

    /**
    * foldersList event is fired when the property changes.
    * event: foldersList
    * @param {Object} the foldersList object.
    **/
    foldersList: null,

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

    inited: false,

    /**
     * Returns true if there is an account. Should only be
     * called after inited is true.
     */
    hasAccount: function() {
      return (this.getAccountCount() > 0);
    },

    /**
     * Given an account ID, get the account object. Only works once the
     * acctsSlice property is available. Use model.latestOnce to get a
     * handle on an acctsSlice property, then call this method.
     * @param  {String} id account ID.
     * @return {Object}    account object.
     */
    getAccount: function(id) {
      if (!this.acctsSlice || !this.acctsSlice.items) {
        throw new Error('No acctsSlice available');
      }

      var targetAccount;
      this.acctsSlice.items.some(function(account) {
        if (account.id === id) {
          return !!(targetAccount = account);
        }
      });

      return targetAccount;
    },

    /**
     * Get the numbers of configured account.
     * Should only be called after this.inited is true.
     * @return {Number} numbers of account.
     */
    getAccountCount: function() {
      var count = 0;

      if (this.acctsSlice &&
          this.acctsSlice.items &&
          this.acctsSlice.items.length) {
        count = this.acctsSlice.items.length;
      }

      return count;
    },

    /**
     * Call this to initialize the model. It can be called more than once
     * per the lifetime of an app. The usual use case for multiple calls
     * is when a new account has been added.
     *
     * It is *not* called by default in this module to allow for lazy startup,
     * and for cases like unit tests that may not want to trigger a full model
     * creation for a simple UI test.
     *
     * @param  {boolean} showLatest Choose the latest account in the
     * acctsSlice. Otherwise it choose the account marked as the default
     * account.
     */
    init: function(showLatest, callback) {
      require(['api'], (api) => {
        // Multiple model instances can be created, but only one init needs
        // to be done with the backend API.
        if (this === modelCreate.defaultModel) {
          modelInit(this, api);
        }

        this.api = api;

        // If already initialized before, clear out previous state.
        this.release();

        var acctsSlice = api.accounts;

        acctsSlice.on('complete', () => {
          // To prevent a race between Model.init() and
          // acctsSlice.on('complete'), only assign model.acctsSlice when
          // the slice has actually loaded (i.e. after
          // acctsSlice.on('complete') fires).
          this.acctsSlice = acctsSlice;

          saveHasAccount(acctsSlice);

          if (acctsSlice.items.length) {
            // For now, just use the first one; we do attempt to put unified
            // first so this should generally do the right thing.
            // XXX: Because we don't have unified account now, we should
            //      switch to the latest account which user just added.
            var account = showLatest ? acctsSlice.items.slice(-1)[0] :
                                       acctsSlice.defaultAccount;

            this.changeAccount(account, callback);
          } else if (callback) {
            callback();
          }

          this.inited = true;
          this._callEmit('acctsSlice');

          // Once the API/worker has started up and we have received account
          // data, consider the app fully loaded: we have verified full flow
          // of data from front to back.
          if (this === modelCreate.defaultModel) {
            evt.emitWhenListener('metrics:apiDone');
          }
        });

        acctsSlice.on('change', () => {
          saveHasAccount(this, acctsSlice);
        });
      });
    },

    /**
     * Changes the current account tracked by the model. This results
     * in changes to the 'account', 'foldersList' and 'folder' properties.
     * @param  {Object}   account  the account object.
     * @param  {Function} callback function to call once the account and
     * related folder data has changed.
     */
    changeAccount: function(account, callback) {
      // Do not bother if account is the same.
      if (this.account && this.account.id === account.id) {
        if (callback) {
          callback();
        }
        return;
      }

      this._releaseFolders();

      this.account = account;
      this._callEmit('account');

      var onFolderListComplete = () => {
        this.foldersList = foldersList;
        this.foldersList.on('change', this, 'notifyFoldersListOnChange');
        this.selectInbox(callback);
        this._callEmit('foldersList');
      };

      var foldersList = this.account.folders;
      if (foldersList.complete) {
        onFolderListComplete();
      } else {
        foldersList.on('complete', onFolderListComplete);
      }
    },

    /**
     * Given an account ID, change the current account to that account.
     * @param  {String} accountId
     * @return {Function} callback
     */
    changeAccountFromId: function(accountId, callback) {
      if (!this.acctsSlice || !this.acctsSlice.items.length) {
        throw new Error('No accounts available');
      }

      this.acctsSlice.items.some((account) => {
        if (account.id === accountId) {
          this.changeAccount(account, callback);
          return true;
        }
      });
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
        this.folder = folder;
        this._callEmit('folder');
      }
    },

    /**
     * For the already loaded account and associated foldersList,
     * set the inbox as the tracked 'folder'.
     * @param  {Function} callback function called once the inbox
     * has been selected.
     */
    selectInbox: function(callback) {
      this.selectFirstFolderWithType('inbox', callback);
    },

    /**
     * For the already loaded account and associated foldersList, set
     * the given folder as the tracked folder. The account MUST have a
     * folder with the given type, or a fatal error will occur.
     */
    selectFirstFolderWithType: function(folderType, callback) {
      if (!this.foldersList) {
        throw new Error('No foldersList available');
      }

      var folder = this.foldersList.getFirstFolderWithType(folderType);
      if (!folder) {
        dieOnFatalError('We have an account without a folderType ' +
                        folderType + '!', this.foldersList.items);
      }

      if (this.folder && this.folder.id === folder.id) {
        if (callback) {
          callback();
        }
      } else {
        if (callback) {
          this.once('folder', callback);
        }
        this.changeFolder(folder);
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

    /**
     * Triggered by the foldersList onchange event
     * @param  {Object} folder the folder that changed.
     */
    notifyFoldersListOnChange: function(folder) {
      this.emit('foldersListOnChange', folder);
    },

    notifyBackgroundSendStatus: function(data) {
      this.emit('backgroundSendStatus', data);
    },

    // Lifecycle

    _releaseFolders: function() {
      if (this.foldersList) {
        this.foldersList.release();
      }
      this.foldersList = null;

      this.folder = null;
    },

    release: function() {
      if (this.acctsSlice) {
        this.acctsSlice.release();
      }
      this.acctsSlice = null;
      this.account = null;

      this._releaseFolders();
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
