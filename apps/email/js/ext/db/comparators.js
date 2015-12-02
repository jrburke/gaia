define(function (require) {
  'use strict';

  /**
   * Produce an ordering from newest conversation to oldest conversation, breaking
   * ties based on the conversation id in an arbitrary but consistent fashion.
   *
   * NEW-TO-OLD
   */
  function folderConversationComparator(a, b) {
    var dateDelta = b.date - a.date;
    if (dateDelta) {
      return dateDelta;
    }
    // So for the id's, we just want consistent.  We don't actually care about the
    // strict numerical ordering of the underlying conversation identifier (sans
    // account id), so we can just do lexical string ordering for this.
    var aId = a.id;
    var bId = b.id;
    if (bId > aId) {
      return 1;
    } else if (aId > bId) {
      return -1;
    } else {
      return 0;
    }
  }

  /**
   * Produce an ordering from newest message to oldest message, breaking ties
   * based on the id in an arbitrary but consistent fashion.
   *
   * NEW-TO-OLD
   */
  function conversationMessageComparator(a, b) {
    var dateDelta = b.date - a.date;
    if (dateDelta) {
      return dateDelta;
    }
    // So for the id's, we just want consistent.  We don't actually care about the
    // strict numerical ordering of the underlying identifier, although the
    // differences will only start at the (encoded) raw message id.  Which is
    // arbitrary because it's something gmail assigns with no defined behaviour.
    var aId = a.id;
    var bId = b.id;
    if (bId > aId) {
      return 1;
    } else if (aId > bId) {
      return -1;
    } else {
      return 0;
    }
  }

  return {
    folderConversationComparator,
    conversationMessageComparator
  };
});
