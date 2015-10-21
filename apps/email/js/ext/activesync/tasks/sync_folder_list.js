define(function (require) {
  'use strict';

  const evt = require('evt');
  const TaskDefiner = require('../../task_infra/task_definer');

  const normalizeFolder = require('../normalize_folder');
  const AccountSyncStateHelper = require('../account_sync_state_helper');

  const enumerateHierarchyChanges = require('../smotocol/enum_hierarchy_changes');

  /**
   * Sync the folder list for an ActiveSync account.  We leverage IMAP's mix-in
   * for the infrastructure (that wants to move someplace less IMAPpy.)
   */
  return TaskDefiner.defineSimpleTask([require('../../task_mixins/mix_sync_folder_list'), {
    essentialOfflineFolders: [
    // Although the inbox is an online folder, we aren't daring enough to
    // predict its server id, so it will be fixed up later, so we just
    // leave it starting out as offline.  (For Microsoft servers, I believe
    // the inbox does have a consistent guid, but we can't assume Microsoft.)
    {
      type: 'inbox',
      displayName: 'Inbox'
    }, {
      type: 'outbox',
      displayName: 'outbox'
    }, {
      type: 'localdrafts',
      displayName: 'localdrafts'
    }],

    syncFolders: function* (ctx, account) {
      var foldersTOC = account.foldersTOC;
      var conn = yield account.ensureConnection();
      var newFolders = [];
      var modifiedFolders = new Map();

      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[account.id, null]])
      });

      var rawSyncState = fromDb.syncStates.get(account.id);
      var syncState = new AccountSyncStateHelper(ctx, rawSyncState, account.id);

      var emitter = new evt.Emitter();
      var deferredFolders = [];

      function tryAndAddFolder(folderArgs) {
        var maybeFolderInfo = normalizeFolder({
          idMaker: foldersTOC.issueFolderId.bind(syncState),
          serverIdToFolderId: syncState.serverIdToFolderId,
          folderIdToFolderInfo: foldersTOC.foldersById
        }, {
          serverId: folderArgs.ServerId,
          parentServerId: folderArgs.ParentId,
          displayName: folderArgs.DisplayName,
          typeNum: folderArgs.Type
        });
        if (maybeFolderInfo === null) {
          deferredFolders.push(folderArgs);
        } else if (maybeFolderInfo === true) {
          // - we updated the inbox!
          // tell the sync state about our ID mapping.
          syncState.addedFolder(maybeFolderInfo);
          modifiedFolders.set(maybeFolderInfo.id, maybeFolderInfo);
        } else {
          // - totally new folder
          // the syncState needs to know the mapping
          syncState.addedFolder(maybeFolderInfo);
          // plus we should actually surface the folder to the UI
          newFolders.push(maybeFolderInfo);
        }
      }

      emitter.on('add', function (folderArgs) {
        tryAndAddFolder(folderArgs);
      });
      emitter.on('remove', function (serverId) {
        syncState.removedFolder(serverId);
        var folderId = syncState.serverIdToFolderId.get(serverId);
        modifiedFolders.set(folderId, null);
      });

      syncState.hierarchySyncKey = (yield* enumerateHierarchyChanges(conn, { hierarchySyncKey: syncState.hierarchySyncKey, emitter })).hierarchySyncKey;

      // It's possible we got some folders in an inconvenient order (i.e. child
      // folders before their parents). Keep trying to add folders until we're
      // done.
      while (deferredFolders.length) {
        var processFolders = deferredFolders;
        deferredFolders = [];
        for (var folder of processFolders) {
          tryAndAddFolder(folder);
        }
        if (processFolders.length === deferredFolders.length) {
          throw new Error('got some orphaned folders');
        }
      }

      return {
        newFolders,
        modifiedFolders,
        modifiedSyncStates: new Map([[account.id, syncState.rawSyncState]])
      };
    }
  }]);
});
