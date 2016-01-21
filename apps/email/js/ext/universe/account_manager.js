define(function (require) {
  'use strict';

  const logic = require('logic');

  const { accountIdFromFolderId } = require('../id_conversions');

  const { accountModules, engineTaskMappings } = require('../engine_glue');

  const AccountsTOC = require('../db/accounts_toc');
  const FoldersTOC = require('../db/folders_toc');

  /**
   * Helper function that takes a function(id) {} and causes it to return any
   * existing promise with that id in this[mapPropName].  If there was no promise,
   * we invoke the function.
   *
   * This is an attempt to reduce boilerplate while also allowing for very
   * explicit function names indicating what's being loaded, etc.
   */
  function prereqify(mapPropName, func) {
    return function (id) {
      var map = this[mapPropName];
      var promise = map.get(id);
      if (promise) {
        return promise;
      }

      try {
        promise = func.apply(this, arguments);
      } catch (ex) {
        return Promise.reject(ex);
      }
      map.set(id, promise);
      return promise;
    };
  }

  /**
   * Manages account instance life-cycles, and the TOC of accounts and the
   * per-account folder TOC's.
   */
  function AccountManager({ db, universe, taskRegistry }) {
    logic.defineScope(this, 'AccountManager');

    this.db = db;
    // We need to tell the DB about us so that it can synchronously lookup
    // accounts and folders for atomicClobbers and atomicDeltas manipulations.
    db.accountManager = this;
    this.universe = universe;
    this.taskRegistry = taskRegistry;

    /**
     * Maps account id's to their accountDef instances from the moment we hear
     * about the account.  Necessary since we only tell the accountsTOC about
     * the account once things are sufficiently loaded for the rest of the system
     * to know about the account.
     */
    this._immediateAccountDefsById = new Map();
    this.accountsTOC = new AccountsTOC();

    // prereqify maps. (See the helper function above and its usages below.)
    this._taskTypeLoads = new Map();
    this._accountFoldersTOCLoads = new Map();
    this._accountLoads = new Map();

    /**
     * In the case of initial account creation, there will be an available
     * connection that we can transfer directly to the account when it is created.
     * Account creation calls `stashAccountConnection` on us and we put it in
     * here until we here about the account and create it.
     */
    this._stashedConnectionsByAccountId = new Map();

    /**
     * @type{Map<AccountId, FoldersTOC>}
     * Account FoldersTOCs keyed by accountId for use by methods that need
     * synchronous access.  (Or debugging; it's a hassle to pull things out of
     * the prereqify maps.)
     */
    this.accountFoldersTOCs = new Map();
    /**
     * @type{Map<AccountId, Account>}
     * Accounts keyed by AccountId for use by methods that need synchronous
     * access.  (Or debugging.)
     */
    this.accounts = new Map();

    this.db.on('accounts!tocChange', this._onTOCChange.bind(this));
  }
  AccountManager.prototype = {
    /**
     * Initialize ourselves, returning a Promise when we're "sufficiently"
     * initialized.  This means:
     *
     * - The accountsTOC is populated and the accountDefs are known.  This happens
     *   during this call since the MailUniverse gives us this information since
     *   it loaded the account definitions when it loaded its config.
     * - Each account's tasks are loaded and registered with the TaskRegistry.
     *   This is a pre-req to initializing the TaskManager.
     * - Each account's list of folders are loaded and a FolderTOC instantiated
     *   and available for synchronous access.  (In the past, the folders were
     *   stored in a single aggregate object per account and were loaded by the
     *   universe, but we aspire to normalize and decentralize.)
     */
    initFromDB: function (accountDefs) {
      var waitFor = [];

      for (var accountDef of accountDefs) {
        waitFor.push(this._accountAdded(accountDef));
      }
      return Promise.all(waitFor);
    },

    stashAccountConnection: function (accountId, conn) {
      this._stashedConnectionsByAccountId.set(accountId, conn);
    },

    /**
     * Ensure the tasks for the given sync engine have been loaded.  In the future
     * this might become the tasks being 'registered' in the case we can cause
     * some of the tasks to only be loaded when they are actually needed.
     */
    _ensureTasksLoaded: prereqify('_taskTypeLoads', function (engineId) {
      var _this = this;

      return new Promise(function (resolve) {
        require([engineTaskMappings.get(engineId)], function (tasks) {
          _this.taskRegistry.registerPerAccountTypeTasks(engineId, tasks);
          resolve(true);
        });
      });
    }),

    /**
     * Ensure the folders for the given account have been loaded from disk and the
     * FoldersTOC accordingly initialized.
     */
    _ensureAccountFoldersTOC: prereqify('_accountFoldersTOCLoads', function (accountId) {
      var _this2 = this;

      return this.db.loadFoldersByAccount(accountId).then(function (folders) {
        // The FoldersTOC wants this so it can mix in per-account data to the
        // folders so they can stand alone without needing to have references and
        // weird cascades in the front-end.
        var accountDef = _this2.getAccountDefById(accountId);
        var foldersTOC = new FoldersTOC({
          db: _this2.db,
          accountDef,
          folders,
          dataOverlayManager: _this2.universe.dataOverlayManager
        });
        _this2.accountFoldersTOCs.set(accountId, foldersTOC);
        return foldersTOC;
      });
    }),

    /**
     * Ensure the given account has been loaded.
     */
    _ensureAccount: prereqify('_accountLoads', function (accountId) {
      var _this3 = this;

      return this._ensureAccountFoldersTOC(accountId).then(function (foldersTOC) {
        return new Promise(function (resolve) {
          var accountDef = _this3.getAccountDefById(accountId);
          require([accountModules.get(accountDef.type)], function (accountConstructor) {
            var stashedConn = _this3._stashedConnectionsByAccountId.get(accountId);
            _this3._stashedConnectionsByAccountId.delete(accountId);

            var account = new accountConstructor(_this3.universe, accountDef, foldersTOC, _this3.db, stashedConn);
            _this3.accounts.set(accountId, account);
            // If we're online, issue a syncFolderList task.
            if (_this3.universe.online) {
              _this3.universe.syncFolderList(accountId, 'loadAccount');
            }
            resolve(account);
          });
        });
      });
    }),

    acquireAccountsTOC: function (ctx) {
      return ctx.acquire(this.accountsTOC);
    },

    acquireAccount: function (ctx, accountId) {
      var account = this.accounts.get(accountId);
      if (account) {
        return ctx.acquire(account);
      }
      return this._ensureAccount(accountId).then(function (_account) {
        return ctx.acquire(_account);
      });
    },

    acquireAccountFoldersTOC: function (ctx, accountId) {
      var foldersTOC = this.accountFoldersTOCs.get(accountId);
      if (foldersTOC) {
        return ctx.acquire(foldersTOC);
      }
      return this._ensureAccountFoldersTOC(accountId).then(function (_foldersTOC) {
        return ctx.acquire(_foldersTOC);
      });
    },

    /**
     * Return the AccountDef for the given AccountId.  This will return accounts
     * we have not acknowledged the existence of to the AccountsTOC yet.
     */
    getAccountDefById: function (accountId) {
      return this._immediateAccountDefsById.get(accountId);
    },

    /**
     * Return the FolderInfo for the given FolderId.  This is only safe to call
     * after the universe has fully loaded.
     */
    getFolderById: function (folderId) {
      var accountId = accountIdFromFolderId(folderId);
      var foldersTOC = this.accountFoldersTOCs.get(accountId);
      return foldersTOC.foldersById.get(folderId);
    },

    /**
     * Our MailDB.on('accounts!tocChange') listener.
     */
    _onTOCChange: function (accountId, accountDef, isNew) {
      if (isNew) {
        // - Added
        this._accountAdded(accountDef);
      } else if (!accountDef) {
        // - Removed
        this._accountRemoved(accountId);
      } else {
        // - Changed
        // Skip if we haven't reported the account to the TOC yet.  We can tell
        // by the presence of the foldersTOC.  We don't defer the notification
        // because our object identity rules mean that when the accountDef is
        // reported it will be the most up-to-date representation available.
        if (this.accountFoldersTOCs.has(accountId)) {
          this.accountsTOC.__accountModified(accountDef);
        }
      }
    },

    /**
     * When we find out about the existence of an account, ensure that the task
     * definitions are loaded for the account and that we initiate loads of the
     * folders for the account.  The AccountsTOC is only notified about the
     * account after these events have occurred.
     *
     * @returns {Promise}
     *   A promise that's resolved onced our pre-reqs have completed loading and
     *   we have announced the existence of the account via the AccountsTOC.
     */
    _accountAdded: function (accountDef) {
      var _this4 = this;

      logic(this, 'accountExists', { accountId: accountDef.id });

      this._immediateAccountDefsById.set(accountDef.id, accountDef);

      var waitFor = [this._ensureTasksLoaded(accountDef.engine), this._ensureAccountFoldersTOC(accountDef.id)];

      return Promise.all(waitFor).then(function () {
        // If we have a stashed connection, then immediately instantiate the
        // account so that we will also issue a syncFolderList call when an
        // account has just been created.
        //
        // Although this does not seem, nor is it, super clean, we really do not
        // want account_create creating tasks for the freshly created account
        // until after our promises above have run, so this is arguably an okay
        // place to do this.  We probably just want to refactor this out into
        // a more explicit "things to do for freshly created accounts" mechanism.
        // (Maybe a task "account_created" that's per account so the accounts can
        // hang everything they want to do off that.
        if (_this4._stashedConnectionsByAccountId.has(accountDef.id)) {
          _this4._ensureAccount(accountDef.id);
        }

        _this4.accountsTOC.__addAccount(accountDef);
      });
    },

    /**
     * Translate a notification from MailDB that an account has been removed to
     * a call to the AccountsTOC to notify it and clean-up the associated
     * FoldersTOC instance.
     */
    _accountRemoved: function (accountId) {
      var _this5 = this;

      this._immediateAccountDefsById.delete(accountId);

      // - Account cleanup
      // (a helper is needed because a load could be pending)
      var doAccountCleanup = function () {
        var account = _this5.accounts.get(accountId);
        _this5.accounts.delete(accountId);
        _this5._accountLoads.delete(accountId);
        if (account) {
          account.shutdown();
        }
      };

      if (this.accounts.has(accountId)) {
        // We can cleanup immediately if the account is already loaded.
        doAccountCleanup();
      } else if (this._accountLoads.has(accountId)) {
        // If a load is pending, wait for it to finish.
        this._accountLoads.get(accountId).then(doAccountCleanup);
      }

      // - Folder TOCs and Account TOC cleanup
      var doFolderCleanup = function () {
        _this5.accountFoldersTOCs.delete(accountId);
        _this5._accountFoldersTOCLoads.delete(accountId);
        // We don't announce the account to the TOC until the folder TOC loaded,
        // so this is the right place to nuke.
        _this5.accountsTOC.__removeAccountById(accountId);
      };
      if (this.accountFoldersTOCs.has(accountId)) {
        doFolderCleanup();
      } else if (this._accountFoldersTOCLoads.has(accountId)) {
        this._accountFoldersTOCLoads.then(doFolderCleanup);
      }
    }
  };
  return AccountManager;
});
