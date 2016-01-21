define(function (require) {
  'use strict';

  var co = require('co');
  var logic = require('logic');

  var TaskDefiner = require('../../task_infra/task_definer');

  var { makeDaysAgo, makeDaysBefore, quantizeDate, NOW } = require('../../date');

  var imapchew = require('../imapchew');
  var parseImapDateTime = imapchew.parseImapDateTime;

  var FolderSyncStateHelper = require('../vanilla/folder_sync_state_helper');

  var syncbase = require('../../syncbase');

  /**
   * Expand the date-range of known messages for the given folder/label.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'sync_grow',
    args: ['accountId', 'folderId', 'minDays'],

    exclusiveResources: function (args) {
      return [
      // Only one of us/sync_refresh is allowed to be active at a time.
      `sync:${ args.accountId }`];
    },

    priorityTags: function (args) {
      return [`view:folder:${ args.folderId }`];
    },

    execute: co.wrap(function* (ctx, req) {
      // -- Exclusively acquire the sync state for the folder
      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[req.folderId, null]])
      });

      var syncState = new FolderSyncStateHelper(ctx, fromDb.syncStates.get(req.folderId), req.accountId, req.folderId, 'grow');

      // -- Issue a search for the new date range we're expanding to cover.
      // TODO: consider the fast full folder sync heuristic where if the folder
      // only has a few messages we just sync them all.
      // TODO: consider some type of statistical shenanigans based on message
      // sequence number.  Like fetch the dates of N messages around
      // (EXISTS - 50) and then extrapolate a reasonable date choice based on
      // that.
      var searchSpec = { not: { deleted: true } };

      var existingSinceDate = syncState.sinceDate;
      var newSinceDate = undefined;
      if (existingSinceDate) {
        searchSpec.before = new Date(quantizeDate(existingSinceDate));
        newSinceDate = makeDaysBefore(existingSinceDate, syncbase.INITIAL_SYNC_GROWTH_DAYS);
        searchSpec.since = new Date(newSinceDate);
      } else {
        newSinceDate = makeDaysAgo(syncbase.INITIAL_SYNC_DAYS);
        searchSpec.since = new Date(newSinceDate);
      }

      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);

      var syncDate = NOW();

      logic(ctx, 'searching', { searchSpec: searchSpec });
      var folderInfo = account.getFolderById(req.folderId);
      // Find out new UIDs covering the range in question.
      var { mailboxInfo, result: uids } = yield account.pimap.search(folderInfo, searchSpec, { byUid: true });

      // -- Fetch flags and the dates for the new messages
      // We want the date so we can prioritize the synchronization of the
      // message.  We want the flags because the sync state needs to persist and
      // track the flags so it can detect changes in flags in sync_refresh.
      if (uids.length) {
        var newUids = syncState.filterOutKnownUids(uids);

        var { result: messages } = yield account.pimap.listMessages(folderInfo, newUids, ['UID', 'INTERNALDATE', 'FLAGS'], { byUid: true });

        for (var msg of messages) {
          var dateTS = parseImapDateTime(msg.internaldate);
          syncState.yayMessageFoundByDate(msg.uid, dateTS, msg.flags);
        }
      }

      syncState.sinceDate = newSinceDate.valueOf();
      // Do we not have a lastHighUid (because this is our first grow for the
      // folder?)
      if (!syncState.lastHighUid) {
        // Use the UIDNEXT if the server provides it (some are jerks and don't)
        if (mailboxInfo.uidNext) {
          syncState.lastHighUid = mailboxInfo.uidNext - 1;
        }
        // Okay, then try and find the max of all the UIDs we heard about.
        else if (uids.length) {
            // Use logical or in case a NaN somehow got in there for paranoia
            // reasons.
            syncState.lastHighUid = Math.max(...uids) || 0;
          }
          // Oh, huh, no UIDNEXT and no messages found?  Well, just pick 1 if
          // there are some messages but not a huge number.
          // XXX this is horrid; the full-folder fast sync and statistical date
          // choices above should make us be able to avoid this.
          else if (mailboxInfo.exists && mailboxInfo.exists < 100) {
              syncState.lastHighUid = 1;
            }
      }

      yield ctx.finishTask({
        mutations: {
          syncStates: new Map([[req.folderId, syncState.rawSyncState]]),
          umidLocations: syncState.umidLocationWrites
        },
        newData: {
          tasks: syncState.tasksToSchedule
        },
        atomicClobbers: {
          folders: new Map([[req.folderId, {
            lastSuccessfulSyncAt: syncDate,
            lastAttemptedSyncAt: syncDate,
            failedSyncsSinceLastSuccessfulSync: 0
          }]])
        }
      });
    })
  }]);
});
