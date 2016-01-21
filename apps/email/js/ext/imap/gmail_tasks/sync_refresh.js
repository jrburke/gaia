define(function (require) {
  'use strict';

  const co = require('co');
  const logic = require('logic');

  const { shallowClone } = require('../../util');

  const { NOW } = require('../../date');

  const TaskDefiner = require('../../task_infra/task_definer');

  const GmailLabelMapper = require('../gmail/gmail_label_mapper');
  const SyncStateHelper = require('../gmail/sync_state_helper');

  const imapchew = require('../imapchew');
  const parseImapDateTime = imapchew.parseImapDateTime;

  const a64 = require('../../a64');
  const parseGmailConvId = a64.parseUI64;
  const parseGmailMsgId = a64.parseUI64;

  const { accountIdFromFolderId } = require('../../id_conversions');

  /**
   * This is the steady-state sync task that drives all of our gmail sync.
   */
  return TaskDefiner.defineAtMostOnceTask([{
    name: 'sync_refresh',
    binByArg: 'accountId',

    helped_overlay_accounts: function (accountId, marker, inProgress) {
      if (!marker) {
        return null;
      } else if (inProgress) {
        return 'active';
      } else {
        return 'pending';
      }
    },

    /**
     * We will match folders that belong to our account, allowing us to provide
     * overlay data for folders even though we are account-centric.
     * Our overlay push happens indirectly by us announcing on
     * 'accountCascadeToFolders' which causes the folders_toc to generate the
     * overlay pushes for all impacted folders.
     */
    helped_prefix_overlay_folders: [accountIdFromFolderId, function (folderId, accountId, marker, inProgress) {
      if (!marker) {
        return null;
      } else if (inProgress) {
        return 'active';
      } else {
        return 'pending';
      }
    }],

    /**
     * In our planning phase we discard nonsensical requests to refresh
     * local-only folders.
     */
    helped_plan: function (ctx, rawTask) {
      // - Plan!
      var plannedTask = shallowClone(rawTask);
      plannedTask.exclusiveResources = [`sync:${ rawTask.accountId }`];
      // Let our triggering folder's viewing give us a priority boost, Although
      // perhaps this should just be account granularity?
      plannedTask.priorityTags = [`view:folder:${ rawTask.folderId }`];

      return Promise.resolve({
        taskState: plannedTask,
        announceUpdatedOverlayData: [['accounts', rawTask.accountId],
        // ask the account-specific folders_toc for help generating overlay
        // push notifications so we don't have to.
        ['accountCascadeToFolders', rawTask.accountId]]
      });
    },

    helped_execute: co.wrap(function* (ctx, req) {
      // Our overlay logic will report us as active already, so send the update
      // to avoid inconsistencies.  (Alternately, we could mutate the marker
      // with non-persistent changes.)
      ctx.announceUpdatedOverlayData('accounts', req.accountId);
      ctx.announceUpdatedOverlayData('accountCascadeToFolders', req.accountId);

      // -- Exclusively acquire the sync state for the account
      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[req.accountId, null]])
      });
      var rawSyncState = fromDb.syncStates.get(req.accountId);

      // -- Check to see if we need to spin-off a sync_grow instead
      if (!rawSyncState) {
        return {
          // we ourselves are done
          taskState: null,
          newData: {
            tasks: [{
              type: 'sync_grow',
              accountId: req.accountId,
              folderId: req.folderId
            }]
          },
          announceUpdatedOverlayData: [['accounts', req.accountId], ['accountCascadeToFolders', req.accountId]]
        };
      }
      var syncState = new SyncStateHelper(ctx, rawSyncState, req.accountId, 'refresh');

      if (!syncState.modseq) {
        // This is inductively possible, and it's a ridiculously serious problem
        // for us if we issue a FETCH 1:* against the entirety of the All Mail
        // folder.
        throw new Error('missing modseq');
      }

      var foldersTOC = yield ctx.universe.acquireAccountFoldersTOC(ctx, req.accountId);
      var labelMapper = new GmailLabelMapper(foldersTOC);

      // - sync_folder_list dependency-failsafe
      if (foldersTOC.items.length <= 3) {
        // Sync won't work right if we have no folders.  This should ideally be
        // handled by priorities and other bootstrap logic, but for now, just
        // make sure we avoid going into this sync in a broken way.
        throw new Error('moot');
      }

      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var allMailFolderInfo = account.getFirstFolderWithType('all');

      var syncDate = NOW();

      logic(ctx, 'syncStart', { modseq: syncState.modseq });
      var { mailboxInfo, result: messages } = yield account.pimap.listMessages(allMailFolderInfo, '1:*', ['UID', 'INTERNALDATE', 'X-GM-THRID', 'X-GM-LABELS',
      // We don't need/want FLAGS for new messsages (ones with a higher UID
      // than we've seen before), but it's potentially kinder to gmail to
      // ask for everything in a single go.
      'FLAGS',
      // Same deal for the X-GM-MSGID.  We are able to do a more efficient
      // db access pattern if we have it, but it's not really useful in the
      // new conversation/new message case.
      'X-GM-MSGID'], {
        byUid: true,
        changedSince: syncState.modseq
      });

      // To avoid getting redundant information in the future, we need to know
      // the effective modseq of this fetch request.  Because we don't
      // necessarily re-enter the folder above and there's nothing saying that
      // the apparent MODSEQ can only change on entry, we must consider the
      // MODSEQs of the results we are provided.
      var highestModseq = a64.maxDecimal64Strings(mailboxInfo.highestModseq, syncState.modseq);
      for (var msg of messages) {
        var uid = msg.uid; // already parsed into a number by browserbox
        var dateTS = parseImapDateTime(msg.internaldate);
        var rawConvId = parseGmailConvId(msg['x-gm-thrid']);
        // Unwrap the imap-parser tagged { type, value } objects.  (If this
        // were a singular value that wasn't a list it would automatically be
        // unwrapped.)
        var rawLabels = msg['x-gm-labels'].map(function (x) {
          return x.value;
        });
        var flags = msg.flags;

        highestModseq = a64.maxDecimal64Strings(highestModseq, msg.modseq);

        // Have store_labels apply any (offline) requests that have not yet been
        // replayed to the server.
        ctx.synchronouslyConsultOtherTask({ name: 'store_labels', accountId: req.accountId }, { uid: uid, value: rawLabels });
        // same with store_flags
        ctx.synchronouslyConsultOtherTask({ name: 'store_flags', accountId: req.accountId }, { uid: uid, value: flags });

        var labelFolderIds = labelMapper.labelsToFolderIds(rawLabels);

        // Is this a new message?
        if (uid > syncState.lastHighUid) {
          // Does this message meet our sync criteria on its own?
          if (syncState.messageMeetsSyncCriteria(dateTS, labelFolderIds)) {
            // (Yes, it's a yay message.)
            // Is this a conversation we already know about?
            if (syncState.isKnownRawConvId(rawConvId)) {
              syncState.newYayMessageInExistingConv(uid, rawConvId, dateTS);
            } else {
              // no, it's a new conversation to us!
              syncState.newYayMessageInNewConv(uid, rawConvId, dateTS);
            }
            // Okay, it didn't meet it on its own, but does it belong to a
            // conversation we care about?
          } else if (syncState.isKnownRawConvId(rawConvId)) {
              syncState.newMehMessageInExistingConv(uid, rawConvId, dateTS);
            } else {
              // We don't care.
              syncState.newMootMessage(uid);
            }
        } else {
          // It's an existing message
          var newState = {
            rawMsgId: parseGmailMsgId(msg['x-gm-msgid']),
            flags,
            labels: labelFolderIds
          };
          if (syncState.messageMeetsSyncCriteria(dateTS, labelFolderIds)) {
            // it's currently a yay message, but was it always a yay message?
            if (syncState.yayUids.has(uid)) {
              // yes, forever awesome.
              syncState.existingMessageUpdated(uid, rawConvId, dateTS, newState);
            } else if (syncState.mehUids.has(uid)) {
              // no, it was meh, but is now suddenly fabulous
              syncState.existingMehMessageIsNowYay(uid, rawConvId, dateTS, newState);
            } else {
              // Not aware of the message, so inductively this conversation is
              // new to us.
              syncState.existingIgnoredMessageIsNowYayInNewConv(uid, rawConvId, dateTS);
            }
            // Okay, so not currently a yay message, but was it before?
          } else if (syncState.yayUids.has(uid)) {
              // it was yay, is now meh, this potentially even means we no longer
              // care about the conversation at all
              syncState.existingYayMessageIsNowMeh(uid, rawConvId, dateTS);
            } else if (syncState.mehUids.has(uid)) {
              // it was meh, it's still meh, it's just an update
              syncState.existingMessageUpdated(uid, rawConvId, dateTS, newState);
            } else {
              syncState.existingMootMessage(uid);
            }
        }
      }

      syncState.lastHighUid = mailboxInfo.uidNext - 1;
      syncState.modseq = highestModseq;
      syncState.finalizePendingRemovals();
      logic(ctx, 'syncEnd', { modseq: syncState.modseq });

      return {
        mutations: {
          syncStates: new Map([[req.accountId, syncState.rawSyncState]])
        },
        newData: {
          tasks: syncState.tasksToSchedule
        },
        atomicClobbers: {
          accounts: new Map([[req.accountId, {
            syncInfo: {
              lastSuccessfulSyncAt: syncDate,
              lastAttemptedSyncAt: syncDate,
              failedSyncsSinceLastSuccessfulSync: 0
            }
          }]])
        },
        announceUpdatedOverlayData: [['accounts', req.accountId],
        // ask the account-specific folders_toc for help generating overlay
        // push notifications so we don't have to.
        ['accountCascadeToFolders', req.accountId]]
      };
    })
  }]);
});
