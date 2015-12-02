define(function (require) {
  'use strict';

  var co = require('co');

  const { makeFolderMeta } = require('../db/folder_info_rep');

  const { shallowClone } = require('../util');

  /**
   * Mix-in for folder list synchronization and ensuring that an account has all
   * the required offline and online folders.  Offline folders are handled during
   * the planning phase, online folders are handled during the online phase.
   *
   * The logic here isn't particularly complex, but how we handle folders has
   * planned changes, so it seems better to avoid duplicated code even if clarity
   * takes a hit for now.
   *
   * Consumers must provide:
   * - this.syncFolders(ctx, account) returning { modifiedFolders, newFolders,
   *   newTasks }.  This method is responsible for generating deltas to the
   *   current set of folders to reflect the current server state.  If there are
   *   missing online folders, this function should provide tasks in newTasks
   *
   * Consumers may provide, clobbering the default implementation:
   * - this.essentialOfflineFolders: A list of folder definitions for offline
   *   folders.  Alternately, the next method can be implemented instead, mooting
   *   this.
   * - this.ensureEssentialOfflineFolders(ctx, account) returning {
   *   modifiedFolders, newFolders }.  Note that you can also just clobber
   *   essentialOfflineFolders if you need less/more.  *do not mutate it* because
   *   the rep is shared.
   *
   * In the case of POP3 where the server has no concept of folders, all folders
   * are offline folders and the planning stage is smart enough to realize it
   * should conclude the task after planning.
   *
   * XXX this implementation should probably be moved into the global tasks
   * location.
   */
  return {
    name: 'sync_folder_list',
    args: ['accountId'],

    // XXX these are IMAP-specific; these should stay here in an IMAP sub-mix-in
    // (these work for gmail too), while most everything else wants to go into a
    // global mix-in soup.  see higher level comment.
    essentialOfflineFolders: [
    // The inbox is special; we are creating it so that we have an id for it
    // even before we talk to the server.  This makes life easier for UI
    // logic even in weird account creation setups.  The one trick is that
    // the normalizeFolder function and our online step have to be clever to
    // fix-up this speculative folder to be a real folder.
    {
      type: 'inbox',
      // A previous comment indicated the title-case is intentional, although
      // I think our l10n hacks don't care nor does our fixup logic.
      displayName: 'Inbox',
      // IMAP wants this to be at INBOX.  And the other account types don't
      // care.
      path: 'INBOX',
      // The IMAP inbox is an online folder that must exist by definition.
      serverPath: 'INBOX'
    }, {
      type: 'outbox',
      displayName: 'outbox'
    }, {
      type: 'localdrafts',
      displayName: 'localdrafts'
    }],

    ensureEssentialOfflineFolders: function (ctx, account) {
      var foldersTOC = account.foldersTOC;
      var newFolders = [];

      for (var desired of this.essentialOfflineFolders) {
        if (foldersTOC.getCanonicalFolderByType(desired.type) === null) {
          newFolders.push(makeFolderMeta({
            id: foldersTOC.issueFolderId(),
            serverId: null,
            name: desired.displayName,
            type: desired.type,
            path: desired.path || desired.displayName,
            serverPath: desired.serverPath || null,
            parentId: null,
            depth: 0,
            lastSyncedAt: 0
          }));
        }
      }

      return Promise.resolve({
        newFolders
      });
    },

    /**
     * Ensure offline folders.
     */
    plan: co.wrap(function* (ctx, rawTask) {
      var decoratedTask = shallowClone(rawTask);

      decoratedTask.exclusiveResources = [
      // Nothing else that touches folder info is allowed in here.
      `folderInfo:${ rawTask.accountId }`];
      decoratedTask.priorityTags = ['view:folders'];

      var account = yield ctx.universe.acquireAccount(ctx, rawTask.accountId);

      var { newFolders, modifiedFolders } = yield this.ensureEssentialOfflineFolders(ctx, account);

      yield ctx.finishTask({
        mutations: {
          folders: modifiedFolders
        },
        newData: {
          folders: newFolders
        },
        // If we don't have an execute method, we're all done already. (POP3)
        taskState: this.execute ? decoratedTask : null
      });
    }),

    execute: co.wrap(function* (ctx, planned) {
      var account = yield ctx.universe.acquireAccount(ctx, planned.accountId);

      var { modifiedFolders, newFolders, newTasks, modifiedSyncStates } = yield* this.syncFolders(ctx, account);

      // XXX migrate ensureEssentialOnlineFolders to be something the actual
      // instance provides and that we convert into a list of create_folder tasks.
      // (Which implies that mailuniverse should be using task_recipe helpers or
      // something like that?  We should probably ponder the more extreme folder
      // hierarchy situations we could enable like archive-by-month/etc. to help
      // drive the structure.)
      //
      // account.ensureEssentialOnlineFolders();

      yield ctx.finishTask({
        mutations: {
          folders: modifiedFolders,
          syncStates: modifiedSyncStates
        },
        newData: {
          folders: newFolders,
          tasks: newTasks
        },
        // all done!
        taskState: null
      });
    })
  };
});
