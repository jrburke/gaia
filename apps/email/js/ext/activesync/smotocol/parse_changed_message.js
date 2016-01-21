define(function (require) {
  'use strict';

  const em = require('activesync/codepages/Email').Tags;

  /**
   * Parse the given WBXML server representation of a changed message into a
   * flag changes representation.
   *
   * @param {WBXML.Element} node
   */
  function parseChangedMessage(node) {
    var flagChanges = {
      add: null,
      remove: null
    };

    function setFlagState(flag, beSet) {
      if (beSet) {
        if (!flagChanges.add) {
          flagChanges.add = [];
        }
        flagChanges.add.push(flag);
      } else {
        if (!flagChanges.remove) {
          flagChanges.remove = [];
        }
        flagChanges.remove.push(flag);
      }
    }

    for (var child of node.children) {
      var childText = child.children.length ? child.children[0].textContent : null;

      switch (child.tag) {
        case em.Read:
          setFlagState('\\Seen', childText === '1');
          break;
        case em.Flag:
          for (var grandchild of child.children) {
            if (grandchild.tag === em.Status) {
              setFlagState('\\Flagged', grandchild.children[0].textContent !== '0');
            }
          }
          break;
      }
    }

    return { flagChanges };
  }

  return parseChangedMessage;
});
