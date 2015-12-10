define(function (require) {
  'use strict';

  const co = require('co');
  const logic = require('logic');

  const { shallowClone } = require('../../util');

  const TaskDefiner = require('../../task_infra/task_definer');

  const { quantizeDate, NOW } = require('../../date');

  const imapchew = require('../imapchew');
  const parseImapDateTime = imapchew.parseImapDateTime;

  const a64 = require('../../a64');
  const parseGmailConvId = a64.parseUI64;

  const GmailLabelMapper = require('../gmail/gmail_label_mapper');
  const SyncStateHelper = require('../gmail/sync_state_helper');

  const { OLDEST_SYNC_DATE, SYNC_WHOLE_FOLDER_AT_N_MESSAGES,
    GROWTH_MESSAGE_COUNT_TARGET } = require('../../syncbase');

  /**
   * Expand the date-range of known messages for the given folder/label.
   * See sync.md for detailed documentation on our algorithm/strategy.
   */
  return TaskDefiner.defineAtMostOnceTask([require('../task_mixins/imap_mix_probe_for_date'), {
    name: 'sync_grow',
    // Note that we are tracking grow status on folders while we track refresh
    // status on the account as a whole.
    binByArg: 'folderId',

    helped_overlay_folders: function (folderId, marker, inProgress) {
      if (inProgress) {
        return 'active';
      } else if (marker) {
        return 'pending';
      } else {
        return null;
      }
    },

    helped_invalidate_overlays: function (folderId, dataOverlayManager) {
      dataOverlayManager.announceUpdatedOverlayData('folders', folderId);
    },

    helped_already_planned: function (ctx, rawTask) {
      // The group should already exist; opt into its membership to get a
      // Promise
      return Promise.resolve({
        result: ctx.trackMeInTaskGroup('sync_grow:' + rawTask.folderId)
      });
    },

    helped_plan: function (ctx, rawTask) {
      var plannedTask = shallowClone(rawTask);
      plannedTask.exclusiveResources = [`sync:${ rawTask.folderId }`];
      plannedTask.priorityTags = [`view:folder:${ rawTask.folderId }`];

      // Create a task group that follows this task and all its offspring.  This
      // will define the lifetime of our overlay as well.
      var groupPromise = ctx.trackMeInTaskGroup('sync_grow:' + rawTask.folderId);
      return Promise.resolve({
        taskState: plannedTask,
        remainInProgressUntil: groupPromise,
        result: groupPromise
      });
    },

    helped_execute: co.wrap(function* (ctx, req) {
      // -- Exclusively acquire the sync state for the account
      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[req.accountId, null]])
      });

      var syncState = new SyncStateHelper(ctx, fromDb.syncStates.get(req.accountId), req.accountId, 'grow');

      var foldersTOC = yield ctx.universe.acquireAccountFoldersTOC(ctx, req.accountId);
      var labelMapper = new GmailLabelMapper(ctx, foldersTOC);

      // - sync_folder_list dependency-failsafe
      if (foldersTOC.items.length <= 3) {
        // Sync won't work right if we have no folders.  This should ideally be
        // handled by priorities and other bootstrap logic, but for now, just
        // make sure we avoid going into this sync in a broken way.
        throw new Error('moot');
      }

      // -- Enter the label's folder for estimate and heuristic purposes
      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var folderInfo = account.getFolderById(req.folderId);
      var labelMailboxInfo = yield account.pimap.selectMailbox(ctx, folderInfo);

      // Unlike vanilla IMAP, our sync state does not track exactly how many
      // messages are known to be in each folder.  As things are currently
      // implemented, we unfortunately could since we do lock our sync state
      // more often than we want to.  However, with the introduction of
      // sub-tasks, it makes it possible for us to only acquire the sync-state
      // as needed on sync_conv, so that's the opposite direction we want to go.
      // (Also, we might be able to have sync_conv implement some scatter-write
      // that sync_refresh could slurp up when it next runs.)
      //
      // However, we maintain a trigger-based count of the locally known
      // messages in each folder.
      var estimatedUnsyncedMessages = labelMailboxInfo.exists - folderInfo.localMessageCount;

      // NB: Gmail auto-expunges by default, but it can be turned off.  Which is
      // an annoying possibility.
      var searchSpec = { not: { deleted: true } };

      searchSpec['X-GM-LABELS'] = labelMapper.folderIdToLabel(req.folderId);

      var existingSinceDate = syncState.getFolderIdSinceDate(req.folderId);
      var newSinceDate = undefined;
      var firstInboxSync = !existingSinceDate && folderInfo.type === 'inbox';

      // If there are fewer messages left to sync than our constant for this
      // purpose, then just set the date range to our oldest sync date.
      if (!isNaN(estimatedUnsyncedMessages) && estimatedUnsyncedMessages < Math.max(SYNC_WHOLE_FOLDER_AT_N_MESSAGES, GROWTH_MESSAGE_COUNT_TARGET)) {
        newSinceDate = OLDEST_SYNC_DATE;
      } else {
        newSinceDate = yield this._probeForDateUsingSequenceNumbers({
          ctx, account, folderInfo,
          startSeq: labelMailboxInfo.exists - folderInfo.localMessageCount,
          curDate: existingSinceDate || quantizeDate(NOW())
        });
      }

      if (existingSinceDate) {
        searchSpec.before = new Date(quantizeDate(existingSinceDate));
      }
      searchSpec.since = new Date(newSinceDate);

      var syncDate = NOW();

      logic(ctx, 'searching', { searchSpec: searchSpec });
      var allMailFolderInfo = account.getFirstFolderWithType('all');
      // Find out new UIDs covering the range in question.
      var { mailboxInfo, result: uids } = yield account.pimap.search(ctx, allMailFolderInfo, searchSpec, { byUid: true });

      if (uids.length) {
        var { result: messages } = yield account.pimap.listMessages(ctx, allMailFolderInfo, uids, ['UID', 'INTERNALDATE', 'X-GM-THRID'], { byUid: true });

        for (var msg of messages) {
          var uid = msg.uid; // already parsed into a number by browserbox
          var dateTS = parseImapDateTime(msg.internaldate);
          var rawConvId = parseGmailConvId(msg['x-gm-thrid']);

          if (syncState.yayUids.has(uid)) {
            // Nothing to do if the message already met our criteria.  (And we
            // don't care about the flags because they're already up-to-date,
            // inductively.)
          } else if (syncState.mehUids.has(uid)) {
              // The message is now a yay message, hooray!
              syncState.existingMehMessageIsNowYay(uid, rawConvId, dateTS);
            } else {
              // Inductively, this is a newly yay message and potentially the
              // start of a new yay conversation.
              syncState.existingIgnoredMessageIsNowYay(uid, rawConvId, dateTS);
            }
        }
      }

      syncState.setFolderIdSinceDate(req.folderId, newSinceDate.valueOf());
      logic(ctx, 'mailboxInfo', { existingModseq: syncState.modseq,
        newModseq: mailboxInfo.highestModseq, _mailboxInfo: mailboxInfo });
      if (!syncState.modseq) {
        syncState.modseq = mailboxInfo.highestModseq;
        syncState.lastHighUid = mailboxInfo.uidNext - 1;
        logic(ctx, 'updatingModSeq', { modseqNow: syncState.modseq,
          from: mailboxInfo.highestModseq });
      }
      syncState.finalizePendingRemovals();

      var atomicClobbers = {};
      // Treat our first inbox sync as a full sync.  This is true for gaia mail,
      // this is potentially less true for other UIs, but it's true enough.
      if (firstInboxSync) {
        atomicClobbers = {
          accounts: new Map([[req.accountId, {
            syncInfo: {
              lastSuccessfulSyncAt: syncDate,
              lastAttemptedSyncAt: syncDate,
              failedSyncsSinceLastSuccessfulSync: 0
            }
          }]])
        };
      }

      atomicClobbers.folders = new Map([[req.folderId, {
        fullySynced: newSinceDate.valueOf() === OLDEST_SYNC_DATE.valueOf(),
        estimatedUnsyncedMessages,
        syncedThrough: newSinceDate.valueOf()
      }]]);

      return {
        mutations: {
          syncStates: new Map([[req.accountId, syncState.rawSyncState]])
        },
        newData: {
          tasks: syncState.tasksToSchedule
        },
        atomicClobbers
      };
    })
  }]);
});
