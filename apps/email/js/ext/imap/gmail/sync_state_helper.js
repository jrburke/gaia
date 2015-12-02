define(function (require) {
  'use strict';

  var logic = require('logic');

  /**
   * Gmail helper logic for sync tasks to handle interpreting the sync state,
   * manipulating the sync state, and helping track follow-up tasks that may be
   * required.
   *
   * Ideally, this helps make sync_refresh and sync_grow cleaner and easier to
   * read.
   */
  function SyncStateHelper(ctx, rawSyncState, accountId, mode) {
    if (!rawSyncState) {
      logic(ctx, 'creatingDefaultSyncState', {});
      rawSyncState = {
        yayUids: new Map(),
        mehUids: new Map(),
        labelSinceDates: new Map(),
        lastHighUid: 0,
        modseq: ''
      };
    }

    this._ctx = ctx;
    this._accountId = accountId;
    this.rawSyncState = rawSyncState;
    this._growMode = mode === 'grow';

    /**
     * A mapping folder FolderId to the SINCE dateTS that characterizes our
     * understanding of the label if we've synced the folder/label before.
     */
    this._labelSinceDates = rawSyncState.labelSinceDates;

    // The UIDs we care about because they meet the sync criteria on their own,
    // and the (raw gmail) conversation id that they belong to.
    this.yayUids = rawSyncState.yayUids;
    // The UIDs we care about because they belong to a conversation we care about,
    // and the (raw gmail) conversation id that they belong to.
    this.mehUids = rawSyncState.mehUids;

    this.rawConvIdToConvStash = new Map();
    this._deriveRawConvIdToConvStash();

    this._stashesPendingForRemoval = new Set();

    // A running list of tasks to spin-off
    this.tasksToSchedule = [];

    // metrics to determine how useful this firehose is.  if we're seeing
    // significantly more data than we can use, we may want to consider using
    // a search pre-filter stage
    this.metricUseful = 0;
    this.metricWaste = 0;
  }
  SyncStateHelper.prototype = {
    get lastHighUid() {
      return this.rawSyncState.lastHighUid;
    },

    set lastHighUid(val) {
      this.rawSyncState.lastHighUid = val;
    },

    get modseq() {
      return this.rawSyncState.modseq;
    },

    set modseq(val) {
      this.rawSyncState.modseq = val;
    },

    _deriveRawConvIdToConvStash: function () {
      var rawConvIdToConvStash = this.rawConvIdToConvStash;
      for (var [yayUid, rawConvId] of this.yayUids) {
        var stash = rawConvIdToConvStash.get(rawConvId);
        if (!stash) {
          stash = {
            rawConvId: rawConvId,
            yayUids: [yayUid],
            mehUids: [],
            // The most recent message for the conversation we're aware of in this
            // sync batch.  We only care about this for task prioritization
            // reasons, which is why this isn't persisted as part of our state.
            mostRecent: 0,
            task: null
          };
          rawConvIdToConvStash.set(rawConvId, stash);
        } else {
          stash.yayUids.push(yayUid);
        }
      }
      for (var [mehUid, rawConvId] of this.mehUids) {
        var stash = rawConvIdToConvStash.get(rawConvId);
        if (!stash) {
          // This should not be happening...
          logic(this._ctx, 'mehWithoutYay', { mehUid: mehUid, rawConvId: rawConvId });
        } else {
          stash.yayUids.push(mehUid);
        }
      }
      logic(this._ctx, 'derivedData', { numYay: this.yayUids.size, numMeh: this.mehUids.size,
        numConvs: rawConvIdToConvStash.size });
    },

    getFolderIdSinceDate: function (folderId) {
      return this._labelSinceDates.get(folderId);
    },

    setFolderIdSinceDate: function (folderId, sinceDate) {
      this._labelSinceDates.set(folderId, sinceDate);
    },

    /**
     * Does this message meet our primary sync criteria by having a label that
     * we're interested in and a date that satisfies the SINCE criteria we are
     * using for that label?
     */
    messageMeetsSyncCriteria: function (date, folderIds) {
      var labelSinceDates = this._labelSinceDates;
      for (var folderId of folderIds) {
        var sinceDate = labelSinceDates.get(folderId);
        if (!sinceDate) {
          continue;
        }
        if (date >= sinceDate) {
          return true;
        }
      }

      return false;
    },

    _makeConvTask: function (rawConvId) {
      var convId = this._accountId + '.' + rawConvId;
      var task = {
        type: 'sync_conv',
        accountId: this._accountId,
        convId,
        newConv: false,
        removeConv: false,
        newUids: null, // set
        modifiedUids: null, // map ( uid => newStateObj )
        removedUids: null,
        mostRecent: 0
      };
      this.tasksToSchedule.push(task);
      return task;
    },

    _updateTaskWithNewUid: function (stash, uid, rawConvId, dateTS) {
      // If we're in grow mode, we don't need to update state for the UIDs and so
      // we don't need to generate a task.
      if (this._growMode) {
        return;
      }
      if (!stash.task) {
        stash.task = this._makeConvTask(rawConvId);
      }
      var task = stash.task;
      if (!task.newConv) {
        // (don't specify uid's if it's a new conversation)
        if (!task.newUids) {
          task.newUids = new Set();
        }
        task.newUids.add(uid);
      }
      if (dateTS > stash.mostRecent) {
        stash.mostRecent = dateTS;
        task.mostRecent = dateTS;
      }
    },

    _updateTaskWithModifiedUid: function (stash, uid, rawConvId, newState) {
      if (!stash.task) {
        stash.task = this._makeConvTask(rawConvId);
      }
      var task = stash.task;
      if (!task.newConv) {
        // (don't specify uid's if it's a new conversation)
        if (!task.modifiedUids) {
          task.modifiedUids = new Map();
        }
        task.modifiedUids.set(uid, newState);
      }
    },

    _updateTaskWithRemovedUid: function (stash, uid, rawConvId, dateTS) {
      if (!stash.task) {
        stash.task = this._makeConvTask(rawConvId);
      }
      var task = stash.task;
      if (!task.newConv) {
        // (don't specify uid's if it's a new conversation)
        if (!task.removedUids) {
          task.removedUids = new Set();
        }
        task.removedUids.add(uid);
      }
    },

    _updateForRemoval: function (stash) {
      stash.task.removeConv = true;
      // note: it's impossible for newConv to be true at this point since we
      // should only hear about each message once and newConv being true means
      // we've put a uid in yayUids and so we can't be removing it during this
      // sync "round".
      this._stashesPendingForRemoval.add(stash);
    },

    _updateSavedFromRemoval: function (stash) {
      stash.task.removeConv = false;
      this._stashesPendingForRemoval.delete(stash);
    },

    isKnownRawConvId: function (rawConvId) {
      return this.rawConvIdToConvStash.has(rawConvId);
    },

    /**
     * It's a new message that meets our sync criteria and it's the first message
     * we've heard of in this conversation, so it's a new conversation!
     */
    newYayMessageInNewConv: function (uid, rawConvId, dateTS) {
      this.metricUseful++;
      this.yayUids.set(uid, rawConvId);
      var stash = {
        rawConvId: rawConvId,
        yayUids: [uid],
        mehUids: [],
        mostRecent: dateTS,
        task: this._makeConvTask(rawConvId)
      };
      this.rawConvIdToConvStash.set(rawConvId, stash);

      stash.task.newConv = true;
      stash.task.mostRecent = dateTS;
    },

    newYayMessageInExistingConv: function (uid, rawConvId, dateTS) {
      this.metricUseful++;
      this.yayUids.set(uid, rawConvId);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.yayUids.push(uid);
      this._updateTaskWithNewUid(stash, uid, rawConvId, dateTS);
    },

    newMehMessageInExistingConv: function (uid, rawConvId, dateTS) {
      this.metricUseful++;
      this.mehUids.set(uid, rawConvId);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.mehUids.push(uid);
      // In the sync_conv case we won't have a dateTS nor will we care about
      // tasks.
      if (dateTS) {
        this._updateTaskWithNewUid(stash, uid, rawConvId, dateTS);
      }
    },

    newMootMessage: function (uid) {
      this.metricWaste++;
    },

    existingIgnoredMessageIsNowYay: function (uid, rawConvId, dateTS) {
      if (this.isKnownRawConvId(rawConvId)) {
        this.newYayMessageInExistingConv(uid, rawConvId, dateTS);
      } else {
        this.newYayMessageInNewConv(uid, rawConvId, dateTS);
      }
    },

    /**
     * The previously yay message is now meh, which potentially means that we
     * no longer care about the message and should purge the conversation from
     * disk.
     */
    existingYayMessageIsNowMeh: function (uid, rawConvId, dateTS, newState) {
      this.metricUseful++;
      this.yayUids.delete(uid);
      this.mehUids.set(uid, rawConvId);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.yayUids.splice(stash.yayUids.indexOf(uid), 1);
      stash.mehUids.push(uid);
      // If there's no longer anything keeping the conversation alive, convert the
      // task to a deletion task by flagging it as such.  We still keep updating
      // the UIDs in case some subsequent fetch result pushes us back over to
      // keeping the conversation
      this._updateTaskWithModifiedUid(stash, uid, rawConvId, newState);
      if (stash.yayUids.length === 0) {
        this._updateForRemoval(stash);
      }
    },

    /**
     * The previously meh message is now yay, which matters if the conversation
     * ran out of yay messages during this sync "round" and now we need to rescue
     * it from doom.
     */
    existingMehMessageIsNowYay: function (uid, rawConvId, dateTS, newState) {
      this.metricUseful++;
      this.mehUids.delete(uid);
      this.yayUids.set(uid, rawConvId);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.mehUids.splice(stash.mehUids.indexOf(uid), 1);
      stash.yayUids.push(uid);
      this._updateTaskWithModifiedUid(stash, uid, rawConvId, newState);
      // If we just made this conversation relevant again
      if (stash.yayUids.length === 1) {
        this._updateSavedFromRemoval(stash);
      }
    },

    existingMessageUpdated: function (uid, rawConvId, dateTS, newState) {
      this.metricUseful++;
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      this._updateTaskWithModifiedUid(stash, uid, rawConvId, newState);
    },

    yayMessageDeleted: function (uid) {
      var rawConvId = this.yayUids.get(uid);
      this.yayUids.delete(uid);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.yayUids.splice(stash.yayUids.indexOf(uid), 1);
      this._updateTaskWithRemovedUid(stash, uid);
      // This deletion may be resulting in the conversation no longer being
      // relevant.
      if (stash.yayUids.length === 0) {
        this._updateForRemoval(stash);
      }
    },

    mehMessageDeleted: function (uid) {
      var rawConvId = this.mehUids.get(uid);
      this.mehUids.delete(uid);
      var stash = this.rawConvIdToConvStash.get(rawConvId);
      stash.mehUids.splice(stash.mehUids.indexOf(uid), 1);
      this._updateTaskWithRemovedUid(stash, uid);
    },

    existingMootMessage: function (uid) {
      this.metricWaste++;
    },

    /**
     * Finalize any pending removals by removing all uid state.  Call this after
     * all sync manipulations have occurred and prior to issuing a database write
     * with our raw state.
     */
    finalizePendingRemovals: function () {
      for (var stash of this._stashesPendingForRemoval) {
        for (var uid of stash.mehUids) {
          this.mehUids.delete(uid);
        }
        this.rawConvIdToConvStash.delete(stash.rawConvId);
      }
      this._stashesPendingForRemoval.clear();
    }
  };

  return SyncStateHelper;
});
