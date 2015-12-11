
/**
 * For test, page injection development.
 * A cross-platform programmable Fiddler alternative.
 * You can even replace express.js with it's `flow` function.
 */
var Overview, Promise, Socket, _, boxBufferFrame, flow, http, kit, net, proxy, regConnectHost, regTunnelBegin, unboxBufferFrame;

Overview = 'proxy';

kit = require('./kit');

_ = kit._, Promise = kit.Promise;

http = require('http');

flow = require('noflow');

net = kit.require('net', __dirname);

Socket = net.Socket;

regConnectHost = /([^:]+)(?::(\d+))?/;

regTunnelBegin = /^\w+\:\/\//;

boxBufferFrame = function(data) {
  var digit, i, len, sizeBuf;
  if (!Buffer.isBuffer(data)) {
    data = new Buffer(data);
  }
  len = data.length;
  sizeBuf = new Buffer([0, 0, 0, 0]);
  digit = 0;
  i = 0;
  while (len > 0) {
    digit = len % 256;
    len = (len - digit) / 256;
    sizeBuf[i++] = digit;
  }
  return Buffer.concat([sizeBuf, data]);
};

unboxBufferFrame = function(sock, opts, head) {
  var buf, check, len;
  buf = new Buffer(0);
  len = null;
  check = function(chunk) {
    var results;
    buf = Buffer.concat([buf, chunk]);
    results = [];
    while (true) {
      if (len === null) {
        len = buf[0] + buf[1] * 256 + buf[2] * 65536 + buf[3] * 16777216;
        buf = buf.slice(4);
      }
      if (len !== null && buf.length >= len) {
        if (typeof opts.data === "function") {
          opts.data(buf.slice(0, len));
        }
        buf = buf.slice(len);
        results.push(len = null);
      } else {
        break;
      }
    }
    return results;
  };
  if (head && head.length > 0) {
    check(head);
  }
  return sock.on('data', check);
};

proxy = {
  agent: new http.Agent,

  /**
   * A simple request body middleware.
   * @return {Function} `(ctx) -> Promise`
   */
  body: function(opts) {
    return function(ctx) {
      return new Promise(function(resolve, reject) {
        var buf;
        buf = new Buffer(0);
        ctx.req.on('data', function(chunk) {
          return buf = Buffer.concat([buf, chunk]);
        });
        ctx.req.on('error', reject);
        return ctx.req.on('end', function() {
          if (buf.length > 0) {
            ctx.reqBody = buf;
          }
          return ctx.next().then(resolve, reject);
        });
      });
    };
  },

  /**
   * Add a `van` method to flow context object. It's a helper to set
   * and get the context body.
   * @param  {FlowContext} ctx
   */
  van: function(ctx) {
    ctx.van = function() {
      if (arguments.length === 0) {
        return ctx.body;
      } else {
        return ctx.body = arguments[0];
      }
    };
    return ctx.next();
  },

  /**
   * Http CONNECT method tunneling proxy helper.
   * Most times it is used to proxy https and websocket.
   * @param {Object} opts Defaults:
   * ```js
   * {
   *  filter: (req) => true, // if it returns false, the proxy will be ignored
   *  host: null, // Optional. The target host force to.
   *  port: null, // Optional. The target port force to.
   *  onError: (err, socket) => {}
   * }
   * ```
   * @return {Function} The connect request handler.
   * @example
   * ```js
   * let kit = require('nokit');
   * let proxy = kit.require('proxy');
   *
   * let app = proxy.flow();
   *
   * // Directly connect to the original site.
   * app.server.on('connect', kit.proxy.connect());
   *
   * app.listen(8123);
   * ```
   */
  connect: function(opts) {
    var host, port, ref;
    if (opts == null) {
      opts = {};
    }
    _.defaults(opts, {
      filter: function(req) {
        return true;
      },
      host: null,
      port: null,
      onError: function(err, req, socket) {
        var br;
        br = kit.require('brush');
        kit.log(err.toString() + ' -> ' + br.red(req.url));
        return socket.end();
      }
    });
    if (opts.host) {
      if (opts.host.indexOf(':') > -1) {
        ref = opts.host.split(':'), host = ref[0], port = ref[1];
      } else {
        host = opts.host, port = opts.port;
      }
    }
    return function(req, sock, head) {
      var isProxy, ms, psock;
      if (!opts.filter(req)) {
        return;
      }
      isProxy = req.headers['proxy-connection'];
      ms = isProxy ? req.url.match(regConnectHost) : req.headers.host.match(regConnectHost);
      psock = new Socket;
      psock.connect(port || ms[2] || 80, host || ms[1], function() {
        var h, i, j, len1, rawHeaders, ref1;
        if (isProxy) {
          sock.write("HTTP/" + req.httpVersion + " 200 Connection established\r\n\r\n");
        } else {
          rawHeaders = req.method + " " + req.url + " HTTP/" + req.httpVersion + "\r\n";
          ref1 = req.rawHeaders;
          for (i = j = 0, len1 = ref1.length; j < len1; i = ++j) {
            h = ref1[i];
            rawHeaders += h + (i % 2 === 0 ? ': ' : '\r\n');
          }
          rawHeaders += '\r\n';
          psock.write(rawHeaders);
        }
        if (head.length > 0) {
          psock.write(head);
        }
        sock.pipe(psock);
        return psock.pipe(sock);
      });
      sock.on('error', function(err) {
        return opts.onError(err, req, sock);
      });
      return psock.on('error', function(err) {
        return opts.onError(err, req, psock);
      });
    };
  },

  /**
   * A socket p2p middleware on http CONNECT.
   * @param  {Object} opts
   * ```js
   * {
   *     onConnect: (req, write) => {},
   *     filter: (req) => true,
   *     onError: (err, req, sock) => {}
   * }
   * ```
   * @return {Function}
   */
  connectServant: function(opts) {
    if (opts == null) {
      opts = {};
    }
    _.defaults(opts, {
      filter: function(req) {
        return true;
      },
      onError: function(err, req, sock) {
        var br;
        br = kit.require('brush');
        kit.log(err.toString() + ' -> ' + br.red(req.url));
        return sock.end();
      }
    });
    return function(req, sock, head) {
      if (!opts.filter(req)) {
        return;
      }
      unboxBufferFrame(sock, opts, head);
      if (typeof opts.onConnect === "function") {
        opts.onConnect(req, function(data) {
          return sock.write(boxBufferFrame(data));
        });
      }
      return sock.on('error', function(err) {
        return opts.onError(err, req, sock);
      });
    };
  },

  /**
   * A socket p2p client to http CONNECT.
   * @param  {Object} opts
   * ```js
   * {
   *     onConnect: (req, write) => {},
   *     retry: 0,
   *     host: '127.0.0.1',
   *     port: 80
   * }
   * ```
   */
  connectClient: function(opts) {
    var connect;
    _.defaults(opts, {
      retry: 0,
      host: '127.0.0.1',
      port: 80
    });
    connect = function() {
      var client;
      return client = net.connect(opts.port, opts.host, function() {
        client.write("CONNECT " + (opts.url || '/') + " HTTP/1.1\r\n\r\n");
        if (typeof opts.onConnect === "function") {
          opts.onConnect(client, function(data) {
            return client.write(boxBufferFrame(data));
          });
        }
        unboxBufferFrame(client, opts);
        if (opts.retry) {
          return client.on('error', function() {
            return setTimeout(connect, opts.retry);
          });
        } else if (opts.onError) {
          return client.on('error', opts.onError);
        }
      });
    };
    return connect();
  },

  /**
   * Create a etag middleware.
   * @return {Function}
   */
  etag: function() {
    var Stream, jhash;
    Stream = require('stream');
    jhash = new (kit.require('jhash').constructor);
    return function(ctx) {
      return ctx.next().then(function() {
        return Promise.resolve(ctx.body).then(function(data) {
          var hash;
          if (data instanceof Stream) {
            return;
          }
          hash = jhash.hash(data);
          if (+ctx.req.headers['if-none-match'] === hash) {
            ctx.res.statusCode = 304;
            ctx.res.end();
            return kit.end();
          }
          if (!ctx.res.headersSent) {
            return ctx.res.setHeader('ETag', hash);
          }
        });
      });
    };
  },

  /**
   * A minimal middleware composer for the future.
   * https://github.com/ysmood/noflow
   */
  flow: flow["default"],

  /**
   * Generate an express like unix path selector. See the example of `proxy.flow`.
   * @param {String} pattern
   * @param {Object} opts Same as the [path-to-regexp](https://github.com/pillarjs/path-to-regexp)'s
   * options.
   * @return {Function} `(String) -> Object`.
   * @example
   * ```js
   * let proxy = kit.require('proxy');
   * let match = proxy.match('/items/:id');
   * kit.log(match('/items/10')) // output => { id: '10' }
   * ```
   */
  match: function(pattern, opts) {
    var keys, parse, reg;
    parse = kit.requireOptional('path-to-regexp', __dirname, '^1.2.0');
    keys = [];
    reg = parse(pattern, keys, opts);
    return function(url) {
      var ms, qsIndex;
      qsIndex = url.indexOf("?");
      ms = qsIndex > -1 ? url.slice(0, qsIndex).match(reg) : ms = url.match(reg);
      if (ms === null) {
        return;
      }
      return ms.reduce(function(ret, elem, i) {
        if (i === 0) {
          return {};
        }
        ret[keys[i - 1].name] = elem;
        return ret;
      }, null);
    };
  },

  /**
   * Convert a Express-like middleware to `proxy.flow` middleware.
   * @param  {Function} h `(req, res, next) ->`
   * @return {Function}   `(ctx) -> Promise`
   * ```js
   * let proxy = kit.require('proxy');
   * let http = require('http');
   * let bodyParser = require('body-parser');
   *
   * let middlewares = [
   *     proxy.midToFlow(bodyParser.json()),
   *
   *     (ctx) => ctx.body = ctx.req.body
   * ];
   *
   * http.createServer(proxy.flow(middlewares)).listen(8123);
   * ```
   */
  midToFlow: function(h) {
    return function(ctx) {
      return new Promise(function(resolve, reject) {
        return h(ctx.req, ctx.res, function(err) {
          if (err) {
            reject(err);
          } else {
            ctx.next().then(resolve, reject);
          }
        });
      });
    };
  },

  /**
   * Create a conditional middleware that only works when the pattern matches.
   * @param  {Object} sel The selector. Members:
   * ```js
   * {
   *  url: String | Regex | Function,
   *  method: String | Regex | Function,
   *  headers: Object
   * }
   * ```
   * When it's not an object, it will be convert via `sel = { url: sel }`.
   * The `url`, `method` and `headers` are act as selectors. If current
   * request matches the selector, the `middleware` will be called with the
   * captured result. If the selector is a function, it should return a
   * `non-undefined, non-null` value when matches, it will be assigned to the `ctx`.
   * When the `url` is a string, if `req.url` starts with the `url`, the rest
   * of the string will be captured.
   * @param  {Function} middleware
   * @return {Function}
   */
  select: function(sel, middleware) {
    var matchHeaders, matchKey;
    if (!_.isPlainObject(sel)) {
      sel = {
        url: sel
      };
    }
    matchKey = function(ctx, obj, key, pattern) {
      var ret, str;
      if (pattern === void 0) {
        return true;
      }
      str = obj[key];
      if (!_.isString(str)) {
        return false;
      }
      ret = _.isString(pattern) ? key === 'url' && _.startsWith(str, pattern) ? (str = str.slice(pattern.length), str === '' ? str = '/' : void 0, str) : str === pattern ? str : void 0 : _.isRegExp(pattern) ? str.match(pattern) : _.isFunction(pattern) ? pattern(str) : void 0;
      if (ret != null) {
        ctx[key] = ret;
        return true;
      }
    };
    matchHeaders = function(ctx, headers) {
      var k, ret, v;
      headers = headers;
      if (headers === void 0) {
        return true;
      }
      ret = {};
      for (k in headers) {
        v = headers[k];
        if (!matchKey(ret, ctx.req.headers, k, v)) {
          return false;
        }
      }
      ctx.headers = ret;
      return true;
    };
    return function(ctx) {
      if (matchKey(ctx, ctx.req, 'method', sel.method) && matchHeaders(ctx, sel.headers) && matchKey(ctx, ctx.req, 'url', sel.url)) {
        if (_.isFunction(middleware)) {
          return middleware(ctx);
        } else {
          return ctx.body = middleware;
        }
      } else {
        return ctx.next();
      }
    };
  },

  /**
   * Create a http request middleware.
   * @param  {Object} opts Same as the sse.
   * @return {Function} `(req, res, next) ->`.
   * It has some extra properties:
   * ```js
   * {
   *  ssePrefix: '/nokit-sse',
   *  logPrefix: '/nokit-log',
   *  sse: kit.sse,
   *  watch: (filePath, reqUrl) => {}
   * }
   * ```
   * @example
   * Visit 'http://127.0.0.1:80123', every 3 sec, the page will be reloaded.
   * If the `./static/default.css` is modified, the page will also be reloaded.
   * ```js
   * let kit = require('nokit');
   * let http = require('http');
   * let proxy = kit.require('proxy');
   * let handler = kit.browserHelper();
   *
   * http.createServer(proxy.flow([handler]))
   * .listen(8123).then(() => {
   *     kit.log('listen ' + 8123);
   *
   *     handler.watch('./static/default.css', '/st/default.css');
   *
   *     setInterval(() =>
   *         handler.sse.emit('fileModified', 'changed-file-path.js')
   *     ), 3000);
   * });
   *
   * ```
   * You can also use the `nokit.log` on the browser to log to the remote server.
   * ```js
   * nokit.log({ any: 'thing' });
   * ```
   */
  serverHelper: function(opts) {
    var br, handler, watchList;
    if (opts == null) {
      opts = {};
    }
    br = kit.require('brush');
    opts = _.defaults(opts, {
      ssePrefix: '/nokit-sse',
      logPrefix: '/nokit-log'
    });
    handler = function(ctx) {
      var data, req, res;
      req = ctx.req, res = ctx.res;
      switch (req.url) {
        case opts.ssePrefix:
          handler.sse(req, res);
          return new Promise(function() {});
        case opts.logPrefix:
          data = '';
          req.on('data', function(chunk) {
            return data += chunk;
          });
          req.on('end', function() {
            var e, error;
            try {
              kit.log(br.cyan('client') + br.grey(' | ') + (data ? kit.xinspect(JSON.parse(data)) : data));
              return res.end();
            } catch (error) {
              e = error;
              res.statusCode = 500;
              return res.end(e.stack);
            }
          });
          return new Promise(function() {});
        default:
          return ctx.next();
      }
    };
    handler.sse = kit.require('sse')(opts);
    watchList = [];
    handler.watch = function(path, url) {
      if (_.contains(watchList, path)) {
        return;
      }
      return kit.fileExists(path).then(function(exists) {
        if (!exists) {
          return;
        }
        kit.logs(br.cyan('watch:'), path);
        watchList.push(path);
        return kit.watchPath(path, {
          handler: function() {
            kit.logs(br.cyan('changed:'), path);
            return handler.sse.emit('fileModified', url);
          }
        });
      });
    };
    return handler;
  },

  /**
   * Create a static file middleware for `proxy.flow`.
   * @param  {String | Object} opts Same as the [send](https://github.com/pillarjs/send)'s.
   * It has an extra option `{ onFile: (path, stats, ctx) -> }`.
   * @return {Function} The middleware handler of `porxy.flow`.
   * ```js
   * let proxy = kit.require('proxy');
   * let http = require('http');
   *
   * let middlewares = [proxy.select({ url: '/st' }, proxy.static('static'))]
   *
   * http.createServer(proxy.flow(middlewares)).listen(8123);
   * ```
   */
  "static": function(opts) {
    var send;
    send = kit.requireOptional('send', __dirname, '^0.13.0');
    if (_.isString(opts)) {
      opts = {
        root: opts
      };
    }
    return function(ctx) {
      return new Promise(function(resolve, reject) {
        var path, query, s, url;
        url = _.isString(ctx.url) ? ctx.url : ctx.req.url;
        query = url.indexOf('?');
        path = query < 0 ? url : url.slice(0, query);
        s = send(ctx.req, path, opts);
        if (opts.onFile) {
          s.on('file', function(path, stats) {
            return opts.onFile(path, stats, ctx);
          });
        }
        return s.on('error', function(err) {
          if (err.status === 404) {
            return ctx.next().then(resolve, reject);
          } else {
            err.statusCode = err.status;
            return reject(err);
          }
        }).pipe(ctx.res);
      });
    };
  },

  /**
   * Use it to proxy one url to another.
   * @param {Object | String} opts Other options, if it is a string, it will
   * be converted to `{ url: opts }`. Default:
   * ```js
   * {
   *  // The target url forced to. Optional.
   *  // Such as proxy 'http://test.com/a' to 'http://test.com/b',
   *  // proxy 'http://test.com/a' to 'http://other.com/a',
   *  // proxy 'http://test.com' to 'other.com'.
   *  // It can also be an url object. Such as
   *  // `{ protocol: 'http:', host: 'test.com:8123', pathname: '/a/b', query: 's=1' }`.
   *  url: null,
   *
   *  agent: customHttpAgent,
   *
   *  // Force the header's host same as the url's.
   *  isForceHeaderHost: true,
   *
   *  // You can hack the headers before the proxy send it.
   *  handleReqHeaders: (headers, req) => headers
   *  handleResHeaders: (headers, req, proxyRes) => headers,
   *
   *  // Same option as the `kit.request`'s `handleResPipe`.
   *  handleResPipe: (res, stream) => stream,
   *
   *  // Manipulate the response body content of the response here,
   *  // such as inject script into it. Its return type is same as the `ctx.body`.
   *  handleResBody: (body, req, proxyRes) => body,
   *
   *  // It will log some basic error info.
   *  error: (e, req) => {}
   * }
   * ```
   * @return {Function} `(req, res) => Promise` A middleware.
   * @example
   * ```js
   * let kit = require('nokit');
   * let proxy = kit.require('proxy');
   * let http = require('http');
   *
   * http.createServer(proxy.flow [
   *     // Transparent proxy
   *     proxy.select({ url: '/a' }, proxy.url()),
   *
   *     // Porxy to `a.com`
   *     proxy.select({ url: '/b' }, proxy.url({ url: 'a.com' })),
   *
   *     // Porxy to a file
   *     proxy.select({ url: '/c' }, proxy.url({ url: 'c.com/s.js' })),
   *
   *     proxy.select(
   *         { url: /\/$/, method: 'GET' },
   *         proxy.url({
   *             url: 'd.com',
   *             // Inject script to html page.
   *             handleResBody: (body, req, res) => {
   *                 if (res.headers['content-type'].indexOf('text/html') > -1)
   *                     return body + '<script>alert("test")</script>';
   *                 else
   *                     return body;
   *             }
   *         })
   *     )
   * ]).listen(8123);
   * ```
   */
  url: function(opts) {
    var br, normalizeStream, normalizeUrl;
    kit.require('url');
    br = kit.require('brush');
    if (_.isString(opts)) {
      opts = {
        url: opts
      };
    }
    if (opts == null) {
      opts = {};
    }
    _.defaults(opts, {
      globalBps: false,
      agent: proxy.agent,
      isForceHeaderHost: true,
      handleReqHeaders: function(headers) {
        return headers;
      },
      handleResHeaders: function(headers) {
        return headers;
      },
      handleUrl: function(url) {
        return url;
      },
      error: function(e, req) {
        return kit.logs(e.toString(), '->', br.red(req.url));
      }
    });
    if (opts.handleResBody && !opts.handleResPipe) {
      opts.handleResPipe = function(res, resPipe) {
        return null;
      };
    }
    normalizeUrl = function(req, url) {
      var sepIndex;
      if (!url) {
        url = req.url;
      }
      return opts.handleUrl((function() {
        if (_.isString(url)) {
          sepIndex = url.indexOf('/');
          switch (sepIndex) {
            case 0:
              return {
                protocol: 'http:',
                host: req.headers.host,
                path: url
              };
            case -1:
              return {
                protocol: 'http:',
                host: url,
                path: kit.url.parse(req.url).path
              };
            default:
              return kit.url.parse(url);
          }
        } else {
          return url;
        }
      })());
    };
    normalizeStream = function(res) {
      var bps, sockNum, throttle;
      if (_.isNumber(opts.bps)) {
        if (opts.globalBps) {
          sockNum = _.keys(opts.agent.sockets).length;
          bps = opts.bps / (sockNum + 1);
        } else {
          bps = opts.bps;
        }
        throttle = new kit.requireOptional('throttle', __dirname)(bps);
        throttle.pipe(res);
        return throttle;
      } else {
        return res;
      }
    };
    return function(ctx) {
      var headers, p, req, res, stream, url;
      req = ctx.req, res = ctx.res;
      url = normalizeUrl(req, opts.url);
      headers = opts.handleReqHeaders(req.headers, req);
      stream = normalizeStream(res);
      if (opts.isForceHeaderHost && opts.url) {
        headers['Host'] = url.host;
      }
      p = kit.request({
        method: req.method,
        url: url,
        headers: headers,
        reqPipe: req,
        resPipe: stream,
        handleResPipe: opts.handleResPipe,
        autoUnzip: false,
        agent: opts.agent,
        body: false,
        resPipeError: function() {
          res.statusCode = 502;
          return res.end('Proxy Error: ' + http.STATUS_CODES[502]);
        }
      });
      if (opts.handleResBody) {
        p = p.then(function(proxyRes) {
          var hs, k, v;
          if (_.isUndefined(proxyRes.body)) {
            return;
          }
          ctx.body = opts.handleResBody(proxyRes.body, req, proxyRes);
          hs = opts.handleResHeaders(proxyRes.headers, req, proxyRes);
          for (k in hs) {
            v = hs[k];
            res.setHeader(k, v);
          }
          return res.statusCode = proxyRes.statusCode;
        });
      } else {
        p.req.on('response', function(proxyRes) {
          return res.writeHead(proxyRes.statusCode, opts.handleResHeaders(proxyRes.headers, req, proxyRes));
        });
      }
      p["catch"](function(e) {
        return opts.error(e, req);
      });
      return p;
    };
  }
};

module.exports = proxy;
