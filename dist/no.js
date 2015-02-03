
/*
	A simplified version of Make.
 */
var cmder, error, kit, launch, loadNofile, searchTasks, setGlobals, task, _;

if (process.env.NODE_ENV == null) {
  process.env.NODE_ENV = 'development';
}

kit = require('./kit');

kit.require('colors');

_ = kit._;

cmder = kit.requireOptional('commander', __dirname);

error = function(msg) {
  var err;
  err = new Error(msg);
  err.source = 'nokit';
  throw err;
};

loadNofile = function() {
  var exts, lang, path, paths, _base, _i, _j, _len, _len1, _ref;
  if ((_base = process.env).nokitPreload == null) {
    _base.nokitPreload = 'coffee-cache coffee-script/register';
  }
  _ref = process.env.nokitPreload.split(' ');
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    lang = _ref[_i];
    try {
      require(lang);
    } catch (_error) {}
  }
  exts = _(require.extensions).keys().filter(function(ext) {
    return ['.json', '.node', '.litcoffee', '.coffee.md'].indexOf(ext) === -1;
  });
  paths = kit.genModulePaths('nofile', process.cwd(), '').reduce(function(s, p) {
    return s.concat(exts.map(function(ext) {
      return p + ext;
    }).value());
  }, []);
  for (_j = 0, _len1 = paths.length; _j < _len1; _j++) {
    path = paths[_j];
    if (kit.existsSync(path)) {
      require(path);
      return kit.path.parse(path);
    }
  }
  return error('Cannot find nofile');
};


/**
 * A simplified task wrapper for `kit.task`
 * @param  {String}   name
 * @param  {Array}    deps
 * @param  {String}   description
 * @param  {Boolean}  isSequential
 * @param  {Function} fn
 * @return {Promise}
 */

task = function() {
  var args, depsInfo, helpInfo, names, sep;
  args = kit.defaultArgs(arguments, {
    name: {
      String: 'default'
    },
    deps: {
      Array: null
    },
    description: {
      String: ''
    },
    isSequential: {
      Boolean: null
    },
    fn: {
      Function: function() {}
    }
  });
  depsInfo = args.deps ? (sep = args.isSequential ? ' -> ' : ', ', ("deps: [" + (args.deps.join(sep)) + "]").grey) : '';
  if (args.description) {
    args.description += '  ';
  }
  helpInfo = args.description + depsInfo;
  names = args.name.split(' ');
  return names.forEach(function(name) {
    cmder.command(name).description(helpInfo);
    helpInfo = 'alias' + ' -> '.cyan + names[0];
    return kit.task(name, args, function() {
      return args.fn(cmder);
    });
  });
};

setGlobals = function() {
  var option;
  option = cmder.option.bind(cmder);
  return kit._.extend(global, {
    _: _,
    kit: kit,
    task: task,
    option: option,
    Promise: kit.Promise,
    warp: kit.warp
  });
};

searchTasks = function() {
  var list;
  list = _.keys(kit.task.list);
  return _(cmder.args).map(function(cmd) {
    return kit.fuzzySearch(cmd, list);
  }).compact().value();
};

module.exports = launch = function() {
  var tasks;
  cmder.option('-v, --version', 'output version of nokit', function() {
    var info;
    info = kit.readJsonSync(__dirname + '/../package.json');
    console.log(("nokit@" + info.version).green, ("(" + (require.resolve('./kit')) + ")").grey);
    return process.exit();
  }).usage('[options] [tasks]    # supports fuzzy task name');
  setGlobals();
  loadNofile();
  if (!kit.task.list) {
    return;
  }
  cmder.parse(process.argv);
  if (cmder.args.length === 0) {
    if (kit.task.list['default']) {
      kit.task.run('default', {
        init: cmder
      });
    } else {
      cmder.outputHelp();
    }
    return;
  }
  tasks = searchTasks();
  if (tasks.length === 0) {
    error('No such tasks: ' + cmder.args);
  }
  return kit.task.run(tasks, {
    init: cmder
  });
};
