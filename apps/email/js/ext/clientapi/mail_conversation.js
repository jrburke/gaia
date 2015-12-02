define(function (require) {
  'use strict';

  var evt = require('evt');
  var ContactCache = require('./contact_cache');

  var { accountIdFromConvId } = require('../id_conversions');

  var decorateConversation = require('app_logic/conv_client_decorator');
  var cleanupConversation = require('app_logic/conv_client_cleanup');

  /**
   * @typedef {Object} ConvMsgTidbit
   *
   * Summary info on an interesting/notable message in a conversation.  Note that
   * this is not something that updates.  The conversation updates and these will
   * be completely replaced.  Do not keep references, etc.
   *
   * @property {Date} date
   * @property {Boolean} isRead
   * @property {Boolean} isStarred
   * @property {Boolean} hasAttachments
   * @property {MailPeep} author
   * @property {String} [snippet]
   *   The snippet will eventually show up, but may not be there yet.  The value
   *   will be null if there's no snippet yet or an empty string if we were unable
   *   to derive a snippet from the data we have thus far.
   */

  /**
   * It's a conversation summary.  Eventually this will be contain stuff you the
   * API user will control by providing logic that gets bundled in the build step
   * (or quasi-dynamically if we have magic ServiceWorker things).  For now you
   * get the data I deign to provide.  Complain and I'll replace the data with
   * poorly researched facts about puppies.  Consider yourself warned.
   *
   * CURRENT LIMITATION: MailPeep instances will be re-created all the flipping
   * time by us.  Don't bother listening on them for changes because your
   * listeners will go away.  Eventually we'll just deliver a change notification
   * on the conversation as a whole for you if contact stuff happens.
   *
   * @property {GmailConvId} id
   * @property {Date} mostRecentMessageDate
   *   The (received) date of the most recent message in the conversation.  This
   *   provides the ordering of the conversation.
   * @property {Array<MailFolder>} labels
   *   The labels applied to this conversation.  (Actually, the union of the
   *   per-message labels for all of the messages in the conversation.)
   * @property {String} firstSubject
   *   The subject of the originating thread of the message.
   * @property {Array<MailPeep>} authors
   *   The uniqueified list of authors participating in the conversation.  The 0th
   *   index should be the author who started the thread.
   * @property {Number} headerCount
   *   The number of messages/headers in this conversation that are currently
   *   synchronized.  (There may exist other messages on the server we don't
   *   yet know about or have not yet synchronized.)
   * @property {Number} snippetCount
   *   The number of messages in this conversation for which we have fetched a
   *   snippet for.  (Or tried to fetch a snippet; sometimes we can't extract
   *   a usable snippet until we've downloaded the entire message.)
   * @property {Array<ConvMsgTidbit>} messageTidbits
   *   You get up to 3 of these
   * @property {Boolean} hasUnread
   * @property {Boolean} hasStarred
   * @property {Boolean} hasDraft
   * @property {Boolean} hasAttachments
   */
  function MailConversation(api, wireRep, slice, handle) {
    evt.Emitter.call(this);
    this._api = api;
    this._slice = slice;
    this._handle = handle;

    // Store the wireRep so it can be used for caching.
    this._wireRep = wireRep;

    this.id = wireRep.id;
    this.__update(wireRep, true);
  }
  MailConversation.prototype = evt.mix({
    toString: function () {
      return '[MailConversation: ' + this.id + ']';
    },
    toJSON: function () {
      return {
        type: 'MailConversation',
        id: this.id
      };
    },

    viewMessages: function () {
      return this._api.viewConversationMessages(this);
    },

    /**
     * Return the list of folders that correspond to labels that can be applied to
     * this conversation.
     *
     * XXX currently this is just the list of folders on the given account.  We
     * need to perform filtering based on selectability/etc.
     *
     * @return {MailFolder[]}
     *   A shallow copy of the list of folders.  The items will update, but the
     *  contents of the list won't change.
     */
    getKnownLabels: function () {
      var accountId = accountIdFromConvId(this.id);
      var account = this._api.accounts.getAccountById(accountId);
      return account.folders.items.concat();
    },

    /**
     * Archive the message.  What this means is implementation dependent:
     * - Gmail: The inbox label is removed.
     * - All other account types: Nothing is done.  The idea would be to do what
     *   Thunderbird does and create one or more archive folders (possibly
     *   segmented by date) and trigger a move to that folder.
     */
    archive: function () {
      var accountId = accountIdFromConvId(this.id);
      var account = this._api.accounts.getAccountById(accountId);
      var inboxFolder = account.foldes.getFirstFolderWithType('inbox');
      return this.removeLabels([inboxFolder]);
    },

    /**
     * Add the label identified by the given folder to this conversation.
     *
     * Under the hood, this is implemented by us applying the label to all the
     * messages in the conversation at the time the task is planned.
     */
    addLabels: function (folders) {
      this._api.modifyConversationLabels([this], folders);
    },

    removeLabels: function (folders) {
      this._api.modifyConversationLabels([this], null, folders);
    },

    /**
     *
     */
    modifyTags: function (addTags, removeTags) {
      this._api.modifyConversationTags([this], addTags, removeTags);
    },

    // Alias for hasStarred for symmetry with MailMessage.
    get isStarred() {
      return this.hasStarred;
    },

    /**
     * Mark the conversation as starred or unstarred.
     *
     * @param {Boolean} beStarred
     *   If `true` and we are already isStarred, then nothing will be done.
     *   If `true` and we are not isStarred, then the last message in the
     *   conversation will be starred.
     *   If `false` then all messages in the converastion have their starred
     *   state cleared.
     */
    setStarred: function (beStarred) {
      if (beStarred) {
        if (!this.hasStarred) {
          this._api.modifyConversationTags([this], ['\\Flagged'], null, 'last');
        }
      } else {
        if (this.hasStarred) {
          this._api.modifyConversationTags([this], null, ['\\Flagged']);
        }
      }
    },

    toggleStarred: function () {
      this.setStarred(!this.hasStarred);
    },

    // Inverting alias for symmetry with MailMessage
    get isRead() {
      return !this.hasUnread;
    },

    /**
     * Mark the conversation as read or unread.  This will modify the state of all
     * messages in the conversation uniformly.
     */
    setRead: function (beRead) {
      if (beRead) {
        this.modifyTags(['\\Seen'], null);
      } else {
        this.modifyTags(null, ['\\Seen']);
      }
    },

    toggleRead: function () {
      this.setRead(!this.isRead);
    },

    __update: function (wireRep, firstTime) {
      this._wireRep = wireRep;

      this.height = wireRep.height;
      this.mostRecentMessageDate = new Date(wireRep.date);
      this.firstSubject = wireRep.subject;
      this.messageCount = wireRep.messageCount;
      this.snippetCount = wireRep.snippetCount;
      this.authors = ContactCache.resolvePeeps(wireRep.authors);
      decorateConversation(this, wireRep, firstTime);

      this.labels = this._api._mapLabels(this.id, wireRep.folderIds);

      // Are there any unread messages in this
      this.hasUnread = wireRep.hasUnread;
      this.hasStarred = wireRep.hasStarred;
      this.hasDrafts = wireRep.hasDrafts;
      this.hasAttachments = wireRep.hasAttachments;
    },

    /**
     * Cleanup.
     */
    release: function () {
      ContactCache.forgetPeepInstances(this.authors);
      cleanupConversation(this);
      if (this._handle) {
        this._api._cleanupContext(this._handle);
        this._handle = null;
      }
    }

  });

  return MailConversation;
});
