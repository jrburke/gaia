define(function (require) {
  'use strict';

  const logic = require('logic');

  const TaskDefiner = require('../../task_infra/task_definer');

  const { makeFolderMeta } = require('../../db/folder_info_rep');

  const normalizeFolderType = require('../normalize_folder_type');

  /**
   * Common IMAP folder list syncing logic.
   */
  return TaskDefiner.defineSimpleTask([require('./mix_sync_folder_list'), {
    syncFolders: function* (ctx, account) {
      var { imapAccount, foldersTOC } = account;

      var boxesRoot = yield imapAccount.pimap.listMailboxes();
      var namespaces = yield imapAccount.pimap.listNamespaces();

      if (!namespaces) {
        namespaces = {
          personal: { prefix: '', delimiter: '/' },
          provisional: true
        };
      }

      var newFolders = [];
      var modifiedFolders = new Map();

      // - build a map of known existing folders
      var folderInfoRepsByPath = new Map();
      for (var folderInfoRep of foldersTOC.folders) {
        folderInfoRepsByPath.set(folderInfoRep.path, folderInfoRep);
      }

      // - walk the boxes
      var walkBoxes = (boxLevel, pathDepth, parentId) => {
        boxLevel.forEach(box => {
          var delim = box.delimiter || '/';

          if (box.path.indexOf(delim) === 0) {
            box.path = box.path.slice(delim.length);
          }

          var path = box.path;

          // - normalize jerk-moves
          var type = normalizeFolderType(box, path, namespaces);

          // gmail finds it amusing to give us the localized name/path of its
          // inbox, but still expects us to ask for it as INBOX.
          if (type === 'inbox') {
            path = 'INBOX';
          }

          // - already known folder
          var folderInfoRep = undefined;
          if (folderInfoRepsByPath.has(path)) {
            // Because we speculatively create the Inbox, both its display name
            // and delimiter may be incorrect and need to be updated.
            folderInfoRep = folderInfoRepsByPath.get(path);

            if (folderInfoRep.name !== box.name || folderInfoRep.delim !== delim) {
              folderInfoRep.name = box.name;
              folderInfoRep.delim = delim;
              modifiedFolders.set(folderInfoRep.id, folderInfoRep);
            }
            logic(ctx, 'folder-sync:existing', {
              type,
              name: box.name,
              path,
              delim
            });

            // mark it with true to show that we've seen it.
            folderInfoRepsByPath.set(path, true);
          }
          // - new to us!
          else {
              logic(ctx, 'folder-sync:add', {
                type,
                name: box.name,
                path,
                delim
              });
              folderInfoRep = makeFolderMeta({
                id: foldersTOC.issueFolderId(),
                serverId: null, // (ActiveSync only, we use serverPath)
                name: box.name,
                type,
                path,
                serverPath: path,
                parentId,
                delim,
                depth: pathDepth,
                lastSyncedAt: 0
              });
              newFolders.push(folderInfoRep);
            }

          if (box.children) {
            walkBoxes(box.children, pathDepth + 1, folderInfoRep.id);
          }
        });
      };

      walkBoxes(boxesRoot.children, 0, null);

      // - detect deleted folders
      // track dead folder id's so we can issue a
      for (var folderInfoRep of folderInfoRepsByPath.values()) {
        // skip those we found above
        if (folderInfoRep === true) {
          continue;
        }
        // Ignore local-only folders, as indicated by the lack of a serverPath.
        if (!folderInfoRep.serverPath) {
          continue;
        }
        logic(ctx, 'delete-dead-folder', {
          folderType: folderInfoRep.type,
          folderId: folderInfoRep.id,
          _folderPath: folderInfoRep.path
        });
        // It must have gotten deleted!
        modifiedFolders.set(folderInfoRep.id, null);
      }

      // TODO: normalizeFolderHierarchy relocation of local-only folders to
      // reasonable synthetic paths.  Or stop doing that.

      // TODO ensureEssentialOnlineFolders-style scheduling of online folder
      // creation for sent and trash.

      return {
        newFolders,
        modifiedFolders
      };
    }
  }]);
});
