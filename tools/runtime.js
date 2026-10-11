/* Minimal runtime for exported Design canvas pages: {{holes}}, <sc-for>, <sc-if>,
   onClick/onSubmit handlers, setState re-render via DOM patching. */
(function () {
  'use strict';
  var FORM_NAME = '__FORM_NAME__';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this.__render) this.__render();
  };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    var parts = path.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(scope, p);
      return v == null || v === false ? '' : String(v);
    });
  }

  function child(scope, name, val) {
    var s = Object.create(scope);
    s[name] = val;
    return s;
  }

  function renderNodes(nodes, scope, out, reg) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, out, reg);
  }

  function renderNode(node, scope, out, reg) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var m = WHOLE.exec(node.getAttribute('list') || '');
      var list = m ? lookup(scope, m[1]) : null;
      var as = node.getAttribute('as') || 'item';
      (list || []).forEach(function (item, idx) {
        var s = child(scope, as, item);
        s[as + 'Index'] = idx;
        renderNodes(node.childNodes, s, out, reg);
      });
      return;
    }
    if (tag === 'sc-if') {
      var mv = WHOLE.exec(node.getAttribute('value') || '');
      if (mv && lookup(scope, mv[1])) renderNodes(node.childNodes, scope, out, reg);
      return;
    }

    var el = node.namespaceURI === 'http://www.w3.org/2000/svg'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);

    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, raw = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(raw);
      if (name.length > 2 && name.indexOf('on') === 0) {
        var fn = whole ? lookup(scope, whole[1]) : null;
        if (typeof fn === 'function') {
          reg.push(fn);
          el.setAttribute('data-dc-' + name.slice(2), String(reg.length - 1));
        }
        continue;
      }
      if (name === 'key') name = 'data-key';
      if (whole) {
        var v = lookup(scope, whole[1]);
        if (v == null || v === false) {
          if (name.indexOf('aria-') === 0) el.setAttribute(name, 'false');
          continue;
        }
        el.setAttribute(name, v === true ? (name.indexOf('aria-') === 0 ? 'true' : '') : String(v));
      } else {
        el.setAttribute(name, raw.indexOf('{{') >= 0 ? interp(raw, scope) : raw);
      }
    }
    var kids = tag === 'template' ? node.content.childNodes : node.childNodes;
    renderNodes(kids, scope, el, reg);
    out.appendChild(el);
  }

  function nodeKey(n) {
    if (!n.getAttribute) return undefined;
    var k = n.getAttribute('data-key');
    return k ? k + ':' + n.tagName : (n.id || undefined);
  }

  function encode(data) {
    return Object.keys(data).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
    }).join('&');
  }

  function sendToNetlify(form, inst) {
    var data = { 'form-name': FORM_NAME };
    new FormData(form).forEach(function (v, k) { data[k] = String(v); });
    var extras = typeof inst.formExtras === 'function' ? inst.formExtras() : {};
    Object.keys(extras).forEach(function (k) { data[k] = extras[k]; });
    try {
      fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: encode(data) })
        .catch(function () {});
    } catch (e) { /* offline preview */ }
  }

  window.DC = {
    mount: function (Component) {
      var root = document.getElementById('dc-root');
      var tpl = document.getElementById('dc-tpl').content;
      var inst = new Component({});
      var reg = [];

      inst.__render = function () {
        var next = [];
        var vals = inst.renderVals ? inst.renderVals() : {};
        var fresh = document.createElement('div');
        fresh.id = 'dc-root';
        renderNodes(tpl.childNodes, vals, fresh, next);
        reg = next;
        morphdom(root, fresh, {
          childrenOnly: true,
          getNodeKey: nodeKey,
          onBeforeElUpdated: function (from, to) {
            var t = from.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return false;
            return !from.isEqualNode(to);
          }
        });
      };

      root.addEventListener('click', function (e) {
        var el = e.target.closest('[data-dc-click]');
        if (!el || !root.contains(el) || el.disabled) return;
        var fn = reg[+el.getAttribute('data-dc-click')];
        if (fn) fn(e);
      });
      root.addEventListener('submit', function (e) {
        var form = e.target.closest('[data-dc-submit]');
        if (!form) return;
        e.preventDefault();
        var wasSent = !!inst.state.sent;
        var fn = reg[+form.getAttribute('data-dc-submit')];
        if (!fn) return;
        var fd = new FormData(form);
        var snapshot = {};
        fd.forEach(function (v, k) { snapshot[k] = v; });
        fn({ preventDefault: function () {}, target: form, currentTarget: form });
        if (!wasSent && inst.state.sent) {
          // The form has been swapped for the thank-you message; send the snapshot.
          var ghost = document.createElement('form');
          Object.keys(snapshot).forEach(function (k) {
            var i = document.createElement('input'); i.name = k; i.value = snapshot[k]; ghost.appendChild(i);
          });
          sendToNetlify(ghost, inst);
        }
      });

      inst.__render();
    }
  };
})();
