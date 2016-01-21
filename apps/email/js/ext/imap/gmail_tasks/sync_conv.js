define(function (require) {
  'use strict';

  var logic = require('logic');
  var co = require('co');
  var { shallowClone } = require('../../util');

  var { prioritizeNewer } = require('../../date_priority_adjuster');

  var TaskDefiner = require('../../task_infra/task_definer');
  var a64 = require('../../a64');
  var expandGmailConvId = a64.decodeUI64;

  var { encodedGmailConvIdFromConvId } = require('../../id_conversions');

  var { valuesOnly, chewMessageStructure, parseImapDateTime } = require('../imapchew');

  var { conversationMessageComparator } = require('../../db/comparators');

  var churnConversation = require('../../churn_drivers/conv_churn_driver');

  var SyncStateHelper = require('../gmail/sync_state_helper');
  var GmailLabelMapper = require('../gmail/gmail_label_mapper');

  /**
   * Lose the account id prefix from a convId and convert the a64 rep into base 10
   */
  function convIdToGmailThreadId(convId) {
    var a64Part = convId.substring(convId.indexOf('.') + 1);
    return expandGmailConvId(a64Part);
  }

  var INITIAL_FETCH_PARAMS = ['uid', 'internaldate', 'x-gm-msgid', 'bodystructure', 'flags', 'x-gm-labels', 'BODY.PEEK[' + 'HEADER.FIELDS (FROM TO CC BCC SUBJECT REPLY-TO MESSAGE-ID REFERENCES)]'];

  /**
   * @typedef {Object} SyncConvTaskArgs
   * @prop accountId
   * @prop convId
   * @prop newConv
   * @prop removeConv
   * @prop newUids
   * @prop removedUids
   * @prop revisedUidState
   **/

  /**
   * Fetches the envelopes for new messages in a conversation and also applies
   * flag/label changes discovered by sync_refresh (during planning).
   *
   * XXX??? do the planning stuff in separate tasks.  just have the churner handle
   * things.
   *
   * For a non-new conversation where we are told revisedUidState, in the planning
   * phase, apply the revised flags/labels.  (We handle this rather than
   * sync_refresh because this inherently necessitates a recomputation of the
   * conversation summary which quickly gets to be more work than sync_refresh
   * wants to do in its step.)
   *
   * For a non-new conversation where we are told removedUids, in the planning
   * phase, remove the messages from the database and recompute the conversation
   * summary.
   *
   * For a new conversation, in the execution phase, do a SEARCH to find all the
   * headers, FETCH all their envelopes, and add the headers/bodies to the
   * database.  This requires loading and mutating the syncState.
   *
   * For a non-new conversation where we are told newUids, in the execution
   * phase, FETCH their envelopes and add the headers/bodies to the database.
   * This does not require loading or mutating the syncState; sync_refresh already
   * updated itself.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'sync_conv',

    plan: co.wrap(function* (ctx, rawTask) {
      var plannedTask = shallowClone(rawTask);

      plannedTask.exclusiveResources = [`conv:${ rawTask.convId }`];
      // In the newConv case, we need to load the sync-state for the account
      // in order to add additional meh UIDs we learn about.  This is not
      // particularly desirable, but not trivial to avoid.
      if (rawTask.newConv) {
        plannedTask.exclusiveResources.push(`sync:${ rawTask.accountId }`);
      }

      plannedTask.priorityTags = [`view:conv:${ rawTask.convId }`];

      // Prioritize syncing the conversation by how new it is.
      if (rawTask.mostRecent) {
        plannedTask.relPriority = prioritizeNewer(rawTask.mostRecent);
      }

      yield ctx.finishTask({
        taskState: plannedTask
      });
    }),

    /**
     * Shared code for processing new-to-us messages based on their UID.
     *
     * @param {TaskContext} ctx
     * @param account
     * @param {FolderMeta} allMailFolderInfo
     * @param {ConversationId} convId
     * @param {UID[]} uids
     * @param {SyncStateHelper} [syncState]
     *   For the new conversation case where we may be referencing messages that
     *   are not already known to the sync state and need to be enrolled.  In
     *   most cases these messages will be "meh", but it's also very possible
     *   that server state has changed since the sync_refresh/sync_grow task ran
     *   and that some of those messages will actually be "yay".
     */
    _fetchAndChewUids: function* (ctx, account, allMailFolderInfo, convId, uids, syncState) {
      var messages = [];

      var rawConvId = undefined;
      if (syncState) {
        rawConvId = encodedGmailConvIdFromConvId(convId);
      }

      if (uids && uids.length) {
        var foldersTOC = yield ctx.universe.acquireAccountFoldersTOC(ctx, account.id);
        var labelMapper = new GmailLabelMapper(foldersTOC);

        var { result: rawMessages } = yield account.pimap.listMessages(allMailFolderInfo, uids, INITIAL_FETCH_PARAMS, { byUid: true });

        for (var msg of rawMessages) {
          // Convert the imap-parser tagged { type: STRING, value } for to just
          // values.
          // (Note this is a different set of types from the header parser, and
          // different from flags which are automatically normalized.)
          var rawGmailLabels = valuesOnly(msg['x-gm-labels']);
          var flags = msg.flags || [];
          var uid = msg.uid;

          // If this is a new conversation, we need to track these messages
          if (syncState && !syncState.yayUids.has(uid) && !syncState.mehUids.has(uid)) {
            // (Sync state wants the label status as reflected by the server,
            // so we don't want store_labels to perform fixup for us.)
            var serverFolderIds = labelMapper.labelsToFolderIds(rawGmailLabels);
            var dateTS = parseImapDateTime(msg.internaldate);

            if (syncState.messageMeetsSyncCriteria(dateTS, serverFolderIds)) {
              syncState.newYayMessageInExistingConv(uid, rawConvId);
            } else {
              syncState.newMehMessageInExistingConv(uid, rawConvId);
            }
          }

          // Have store_labels apply any (offline) requests that have not yet
          // been replayed to the server.
          ctx.synchronouslyConsultOtherTask({ name: 'store_labels', accountId: account.id }, { uid: msg.uid, value: rawGmailLabels });
          // same with store_flags
          ctx.synchronouslyConsultOtherTask({ name: 'store_flags', accountId: account.id }, { uid: msg.uid, value: flags });

          var folderIds = labelMapper.labelsToFolderIds(rawGmailLabels);

          var messageInfo = chewMessageStructure(msg, folderIds, flags, convId);
          messages.push(messageInfo);
        }
      }

      return messages;
    },

    /**
     * It's a new conversation so we:
     * - Search to find all the messages in the conversation
     * - Fetch their envelopes, creating HeaderInfo/BodyInfo structures
     * - Derive the ConversationInfo from the HeaderInfo instances
     */
    _execNewConv: co.wrap(function* (ctx, req) {
      var fromDb = yield ctx.beginMutate({
        syncStates: new Map([[req.accountId, null]])
      });

      var syncState = new SyncStateHelper(ctx, fromDb.syncStates.get(req.accountId), req.accountId, 'conv');

      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var allMailFolderInfo = account.getFirstFolderWithType('all');

      // Search for all the messages in the conversation
      var searchSpec = {
        'x-gm-thrid': convIdToGmailThreadId(req.convId)
      };
      var { result: uids } = yield account.pimap.search(allMailFolderInfo, searchSpec, { byUid: true });
      logic(ctx, 'search found uids', { uids });

      var messages = yield* this._fetchAndChewUids(ctx, account, allMailFolderInfo, req.convId, uids, syncState);

      var convInfo = churnConversation(req.convId, null, messages);

      yield ctx.finishTask({
        mutations: {
          syncStates: new Map([[req.accountId, syncState.rawSyncState]])
        },
        newData: {
          conversations: [convInfo],
          messages: messages
        }
      });
    }),

    /**
     * The conversation is no longer relevant or no longer exists, delete all
     * traces of the conversation from our perspective.
     */
    _execDeleteConv: co.wrap(function* (ctx, req) {
      // Deleting a conversation requires us to first load it for mutation so
      // that we have pre-state to be able to remove it from the folder id's
      // it is associated with.
      yield ctx.beginMutate({
        conversations: new Map([[req.convId, null]])
      });
      yield ctx.finishTask({
        mutations: {
          conversations: new Map([[req.convId, null]])
        }
      });
    }),

    /**
     * We learned about new UIDs in a conversation:
     * - Load the existing data about the conversation
     * - Apply any state changes to the already-known messages
     * - Fetch the envelopes for any new message
     * - Rederive/update the ConversationInfo given all the messages.
     */
    _execModifyConv: co.wrap(function* (ctx, req) {
      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var allMailFolderInfo = account.getFirstFolderWithType('all');

      var fromDb = yield ctx.beginMutate({
        conversations: new Map([[req.convId, null]]),
        messagesByConversation: new Map([[req.convId, null]])
      });

      var loadedMessages = fromDb.messagesByConversation.get(req.convId);
      var modifiedMessagesMap = new Map();

      var keptMessages = [];
      for (var message of loadedMessages) {
        if (req.removedUids && req.removedUids.has(message.id)) {
          // removed!
          modifiedMessagesMap.set(message.id, null);
        } else {
          // kept, possibly modified
          keptMessages.push(message);
          if (req.modifiedUids && req.modifiedUids.has(message.id)) {
            var newState = req.modifiedUids.get(message.id);

            message.flags = newState.flags;
            message.labels = newState.labels;

            modifiedMessagesMap.set(message.id, message);
          }
        }
      }

      // Fetch the envelopes from the server and create headers/bodies
      var newMessages = yield* this._fetchAndChewUids(ctx, account, allMailFolderInfo, req.convId, req.newUids && Array.from(req.newUids), false);

      // Ensure the messages are ordered correctly
      var allMessages = keptMessages.concat(newMessages);
      allMessages.sort(conversationMessageComparator);

      var oldConvInfo = fromDb.conversations.get(req.convId);
      var convInfo = churnConversation(req.convId, oldConvInfo, allMessages);

      yield ctx.finishTask({
        mutations: {
          conversations: new Map([[req.convId, convInfo]]),
          messages: modifiedMessagesMap
        },
        newData: {
          messages: newMessages
        }
      });
    }),

    execute: function (ctx, req) {
      // Dispatch based on what actually needs to be done.  While one might
      // think this is begging for 3 separate task types, unification can be
      // applied here and it wants to be conversation-centric in nature,
      // suggesting a single task type is the right call.
      if (req.newConv) {
        return this._execNewConv(ctx, req);
      } else if (req.delConv) {
        return this._execDeleteConv(ctx, req);
      } else {
        return this._execModifyConv(ctx, req);
      }
    }
  }]);
});
