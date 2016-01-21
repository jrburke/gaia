define(function (require) {
  'use strict';

  const co = require('co');
  const evt = require('evt');
  const logic = require('logic');

  const { shallowClone } = require('../../util');
  const { NOW } = require('../../date');

  const TaskDefiner = require('../../task_infra/task_definer');

  const FolderSyncStateHelper = require('../folder_sync_state_helper');

  const getFolderSyncKey = require('../smotocol/get_folder_sync_key');
  const inferFilterType = require('../smotocol/infer_filter_type');
  const enumerateFolderChanges = require('../smotocol/enum_folder_changes');

  const { convIdFromMessageId, messageIdComponentFromUmid } = require('../../id_conversions');

  const churnConversation = require('../../churn_drivers/conv_churn_driver');

  const { SYNC_WHOLE_FOLDER_AT_N_MESSAGES } = require('../../syncbase');

  /**
   * Sync a folder for the first time and steady-state.  (Compare with our IMAP
   * implementations that have special "sync_grow" tasks.)
   */
  return TaskDefiner.defineAtMostOnceTask([{
    name: 'sync_refresh',
    binByArg: 'folderId',

    helped_overlay_folders: function (folderId, marker, inProgress) {
      if (!marker) {
        return null;
      } else if (inProgress) {
        return 'active';
      } else {
        return 'pending';
      }
    },

    /**
     * In our planning phase we discard nonsensical requests to refresh
     * local-only folders.
     *
     * note: This is almost verbatim from the vanilla sync_refresh
     * implementation right now, except for s/serverPath/serverId.  We're on the
     * line right now between whether reuse would be better; keep it in mind as
     * things change.
     */
    helped_plan: co.wrap(function* (ctx, rawTask) {
      // Get the folder
      var foldersTOC = yield ctx.universe.acquireAccountFoldersTOC(ctx, ctx.accountId);
      var folderInfo = foldersTOC.foldersById.get(rawTask.folderId);

      // - Only plan if the folder is real AKA it has a serverId.
      // (We could also look at its type.  Or have additional explicit state.
      // Checking the path is fine and likely future-proof.  The only real new
      // edge case we would expect is offline folder creation.  But in that
      // case we still wouldn't want refreshes triggered before we've created
      // the folder and populated it.)
      var plannedTask = undefined;
      if (!folderInfo.serverId) {
        plannedTask = null;
      } else {
        plannedTask = shallowClone(rawTask);
        plannedTask.exclusiveResources = [`sync:${ rawTask.folderId }`];
        plannedTask.priorityTags = [`view:folder:${ rawTask.folderId }`];
      }

      return {
        taskState: plannedTask,
        announceUpdatedOverlayData: [['folders', rawTask.folderId]]
      };
    }),

    helped_execute: co.wrap(function* (ctx, req) {
      // Our overlay logic will report us as active already, so send the update
      // to avoid inconsistencies.  (Alternately, we could mutate the marker
      // with non-persistent changes.)
      ctx.announceUpdatedOverlayData('folders', req.folderId);

      // -- Exclusively acquire the sync state for the folder
      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[req.folderId, null]])
      });

      var rawSyncState = fromDb.syncStates.get(req.folderId);
      var syncState = new FolderSyncStateHelper(ctx, rawSyncState, req.accountId, req.folderId, 'refresh');

      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var conn = yield account.ensureConnection();

      var folderInfo = account.getFolderById(req.folderId);

      // -- Construct an emitter with our processing logic
      var emitter = new evt.Emitter();
      var newConversations = [];
      var newMessages = [];

      // The id issuing logic is a fundamental part of the 'add'ed message
      // processing.
      var issueIds = function () {
        var umid = syncState.issueUniqueMessageId();
        var convId = req.accountId + '.' + messageIdComponentFromUmid(umid);
        var messageId = convId + '.' + messageIdComponentFromUmid(umid);
        return { messageId, umid, folderId: req.folderId };
      };
      emitter.on('add', function (serverMessageId, message) {
        syncState.newMessage(serverMessageId, message);

        var convId = convIdFromMessageId(message.id);
        newMessages.push(message);
        var convInfo = churnConversation(convId, null, [message]);
        newConversations.push(convInfo);
      });

      emitter.on('change', function (serverMessageId, changes) {
        syncState.messageChanged(serverMessageId, changes);
      });

      emitter.on('remove', function (serverMessageId) {
        syncState.messageDeleted(serverMessageId);
      });

      // It's possible for our syncKey to be invalid, in which case we'll need
      // to run the logic a second time (fetching a syncKey and re-enumerating)
      // so use a loop that errs on the side of not looping.
      var syncKeyTriesAllowed = 1;
      var syncDate = undefined;
      while (syncKeyTriesAllowed--) {
        // - Infer the filter type, if needed.
        // XXX allow the explicit account-level override for filter types.
        // For now we're just pretending auto, which is probably the best option
        // for users in general.  (Unless there was a way to cap the number of
        // messages?  We would want that failsafe...)
        if (!syncState.filterType) {
          logic(ctx, 'inferringFilterType');
          // NB: manual destructing to shut up jslint.
          var results = yield* inferFilterType(conn, {
            folderServerId: folderInfo.serverId,
            desiredMessageCount: SYNC_WHOLE_FOLDER_AT_N_MESSAGES
          });
          syncState.syncKey = results.syncKey;
          syncState.filterType = results.filterType;
        }

        // - Get a sync key if needed
        if (!syncState.syncKey || syncState.syncKey === '0') {
          syncState.syncKey = (yield* getFolderSyncKey(conn, {
            folderServerId: folderInfo.serverId,
            filterType: syncState.filterType
          })).syncKey;
        }

        // - Try and sync
        syncDate = NOW();
        var { invalidSyncKey, syncKey, moreToSync } = yield* enumerateFolderChanges(conn, {
          folderSyncKey: syncState.syncKey,
          folderServerId: folderInfo.serverId,
          filterType: syncState.filterType,
          issueIds,
          emitter
        });

        if (invalidSyncKey) {
          syncKeyTriesAllowed++;
          syncState.syncKey = '0';
          continue;
        }
        syncState.syncKey = syncKey;
        if (moreToSync) {
          syncState.scheduleAnotherRefreshLikeThisOne(req);
        }
      }

      // -- Issue name reads if needed.
      if (syncState.umidNameReads.size) {
        yield ctx.read({
          umidNames: syncState.umidNameReads // mutated as a side-effect.
        });
        syncState.generateSyncConvTasks();
      }

      return {
        mutations: {
          syncStates: new Map([[req.folderId, syncState.rawSyncState]]),
          umidNames: syncState.umidNameWrites,
          umidLocations: syncState.umidLocationWrites
        },
        newData: {
          conversations: newConversations,
          messages: newMessages,
          tasks: syncState.tasksToSchedule
        },
        atomicClobbers: {
          folders: new Map([[req.folderId, {
            lastSuccessfulSyncAt: syncDate,
            lastAttemptedSyncAt: syncDate,
            failedSyncsSinceLastSuccessfulSync: 0
          }]])
        },
        announceUpdatedOverlayData: [['folders', req.folderId]]
      };
    })
  }]);
});
