var Telegraph = function (opts) {
  opts = opts || {chart: "lineChart"};

  this.id         = opts.id;
  this.hash       = opts.hash;
  this.from       = opts.from;
  this.until      = opts.until;
  this.targets    = opts.targets;
  this.chart      = opts.chart;
  this.period     = opts.period;
  this.align      = opts.align;
  this.invert     = opts.invert;
  this.sumCols    = opts.sumCols;
  this.sumRows    = opts.sumRows;
  this.refresh    = opts.refresh;
  this.variables  = opts.variables;

  this.tickCount  = opts.tickCount;
  this.scale      = opts.scale;
};

Telegraph.http = function(method, path, data) {
  var opts = opts || {};

  return $.ajax({
    url: '/' + _.map(path, encodeURIComponent).join('/'),
    dataType: 'json',
    contentType: 'application/json',
    data: JSON.stringify(data),
    type: method.toUpperCase()
  }).then(null, function(results) {
    return results.responseText ? JSON.parse(results.responseText) : {};
  });
};

Telegraph.prototype.http = function(method, opts) {
  return Telegraph.http(method, ['graphs', this.id], opts);
};

Telegraph.baseUrls = {};

Telegraph.requiresMatchingCardinality = function(chart) {
  return _.contains(['table', 'stackedAreaChart', 'multiBarChart'], chart)
};

Telegraph.maxDataPoints = 5000;

Telegraph.prototype.draw = function(selector) {
  var self = this;

  return jQuery.Deferred(function (promise) {
    if (self.variables) {
      try {
        self.vars = JSON.parse(self.variables);
      } catch (e) {
        promise.reject("Error parsing JSON for macro varibles; " + e);
        return;
      }
    } else {
      self.vars = {};
    }
    if (!_.isArray(self.vars)) self.vars = [self.vars];

    $(selector).empty();
    self.clearRefresh();

    if (self.targets && self.targets.length > 0) {
      self.fetchData().done(function(data) {
        var cardinality = Telegraph.cardinality(data);
        var numDataPoints = _.max(cardinality.lengths);
        if (!cardinality.match && Telegraph.requiresMatchingCardinality(self.chart)) {
          promise.reject("Cardinality of data sets must match for this type of chart.");
        } else if (numDataPoints > Telegraph.maxDataPoints) {
          promise.reject("Too many data points. " + "Your query returns " +
                         numDataPoints + ", but the maximum is " + Telegraph.maxDataPoints + ".");
        } else {
          if (self.chart == 'table') {
            self.tableDraw(selector, data);
          } else {
            self.nvDraw(selector, data);
          }
          var refresh = (self.refresh == null) ? Telegraph.defaultRefresh : self.refresh;
          if (refresh) {
            self.refreshInterval = setInterval(_.bind(self.update, self), refresh * 1000);
          }
          promise.resolve();
        }
      });
    } else {
      promise.resolve();
    }
  });
};

Telegraph.prototype.clearRefresh = function() {
  if (this.refreshInterval) clearInterval(this.refreshInterval);
};

Telegraph.timeVals = function(data) {
  return _.mapcat(data, function(datum) {
    return _.map(datum.results, function(results) {
      return _.pluck(results, "x");
    });
  });
};

Telegraph.cardinality = function(data) {
  var timeVals = this.timeVals(data);
  var match = _.every(_.zip.apply(_, timeVals), function (times) {
    return _.uniq(times).length == 1;
  });

  return {
    match: match,
    lengths: _.pluck(timeVals, "length"),
  };
};

_.add = function (a, b) {
  return a + b;
};

_.pointwise = function(colls, f, context) {
  return _.map(_.zip.apply(_, colls), function(a) {
    return _.reduce(_.rest(a), f, _.first(a));
  });
};

Telegraph.prototype.tableItems = function(data) {
  var self = this;

  var scale      = this.scale || Telegraph.timeScale(data);
  var formatTime = scale.tickFormat();
  var formatVal  = function(val) {
    return _.map(val, function(v, i) {
      var format = self.vars[i]._format;
      return format ? _.str.sprintf(format, v) : v;
    });
  };

  var times = [""].concat(_.map(data[0].values, function (val) {
    return formatTime(new Date(val.x * 1000));
  }));

  var rows = _.map(data, function (datum) {
    return _.map(_.zip.apply(_, datum.results), function(vals) {
      return _.pluck(vals, "y")
    });
  });

  var items = _.map(data, function (datum, i) {
    return [datum.key].concat(_.map(rows[i], formatVal));
  });

  if (this.sumRows) {
    _.each(rows, function (row, i) {
      var total = _.pointwise(row, _.add);
      items[i].push(formatVal(total));
    });
    times.push("total");
  }

  if (this.sumCols) {
    var totals = _.pointwise(rows, function (a, b) {
      return _.pointwise([a, b], _.add);
    });
    var grandTotal = _.pointwise(totals, _.add);
    items.push(["total"].concat(_.map(totals, formatVal)));
    if (this.sumRows) _.last(items).push(formatVal(grandTotal));
  }

  return [times].concat(items);
};

Telegraph.prototype.tableCells = function (item, i) {
  var self = this;

  var colSpan = this.vars.length;
  var length  = item.length;

  return _.mapcat(item, function(val, j) {
    var css = (j == 0) ?
        {} :
        {borderLeft: (j == length - 1 || j == 1) ? "double 3px #ccc" : "solid 1px #ddd"};
    if (_.isArray(val)) {
      return _.map(val, function(v, k) {
        var cell = {text: v, title: self.vars[k]._label || JSON.stringify(self.vars[k], null, "  ")};
        if (k == 0) cell.css = css;
        return cell;
      });
    } else {
      return [{
        text: val,
        css: css,
        colSpan: (i == 0 && j > 0 && colSpan > 1) ? colSpan : null,
      }];
    }
  });
};

Telegraph.prototype.tableDraw = function(selector, data) {
  var classes = "telegraph-table table table-striped";
  classes += (this.invert)  ? " inverted"   : " standard";
  classes += (this.sumCols) ? " sum-cols"   : "";
  classes += (this.sumRows) ? " sum-rows" : "";

  var items = this.tableItems(data);
  if (this.invert) items = _.zip.apply(_, items);

  this.table = new Table(selector, {
    toCells: _.bind(this.tableCells, this),
    class:  classes,
    items:  items,
  })
  _.bindAll(this.table);
  this.table.update();
  this.addTableDropdown(data);
};

Telegraph.prototype.addTableDropdown = function(data) {
  var self = this;
  var link = $("<span/>", {class: "dropdown-toggle", "data-toggle": "dropdown", html: "&#x25BE;"});
  var menu = $("<ul/>", {id: "table-menu", class: "dropdown-menu", role: "menu"});
  _.each(this.vars, function(v, i) {
    var suffix = v._label || (i == 0 ? "" : i + 1);
    var name = self.id;
    name += suffix ? " - " + suffix : "";
    menu.append($("<li/>").append(self.csvLink(name, data, i)));
  });

  var cell = $(this.table.selector).find("table tr:first-child td:first-child")
  cell.append($("<div/>", {class: "dropdown"}).append(menu, link));
};

Telegraph.prototype.csvData = function(data, index) {
  var rows = _.map(data, function(datum) {
    return datum.results[index];
  });
  var lines = _.map(_.zip.apply(_, rows), function (col) {
    return [col[0].x].concat(_.pluck(col, "y")).join(",");
  });
  var fields = ["time"].concat(_.pluck(data, "key"));
  return [fields].concat(lines).join("\n");
};

Telegraph.prototype.csvLink = function(name, data, index) {
  var url = "data:application/csv;charset=utf-8," + encodeURIComponent(this.csvData(data, index));
  return $("<a/>", {download: name + ".csv", href: url, text: "Export: " + name});
};

Telegraph.prototype.nvDraw = function(selector, data) {
  var self = this;
  var $container = $(selector)
  var tickCount  = this.tickCount || Math.floor($container.width() / 100);
  var scale      = this.scale     || Telegraph.timeScale(data);

  $container.append("<svg><svg/>");
  this.svg = d3.select(selector).select("svg");
  this.nvChart = Telegraph.makeChart(this.chart, scale, tickCount);

  nv.addGraph(function() {
    self.svg.datum(data)
        .transition().duration(500)
        .call(self.nvChart);
    return self.nvChart;
  });

  nv.utils.windowResize(function() {
    self.updateChart();
  });
};

Telegraph.prototype.subVariables = function(target, variables) {
  return _.reduce(variables, function (target, value, key) {
    var pattern = new RegExp("\\$" + key, 'g');
    return target.replace(pattern, value);
  }, target);
};

Telegraph.queryHasVariables = function(query) {
  return query.match(/\$/);
};

Telegraph.prototype.hasVariables = function() {
  var self = this;
  return _.some(this.targets, function(t) { return t && Telegraph.queryHasVariables(t.query) });
};

Telegraph.timeScale = function(data) {
  var timeVals = this.timeVals(data);
  var min = _.min(_.map(timeVals, function(x) { return _.min(x) }));
  var max = _.max(_.map(timeVals, function(x) { return _.max(x) }));

  var interval = max - min;
  var scale = d3.time.scale();
  scale.domain([new Date(min * 1000), new Date(max * 1000)]);
  return scale;
};

Telegraph.makeChart = function(chart, scale, tickCount) {
  var nvChart = nv.models[chart]();
  var ticks   = _.map(scale.ticks(tickCount), function(d) { return d.getTime() / 1000 });
  var format  = function(d, i) {
    var fmt = (i == null) ? d3.time.format('%X %a %x') : scale.tickFormat(tickCount);
    return fmt(new Date(d * 1000))
  };

  _.each([nvChart.xAxis, nvChart.x2Axis], function (axis) {
    if (axis) axis.showMaxMin(false).tickValues(ticks).tickFormat(format);
  });
  _.each([nvChart.yAxis, nvChart.yAxis1, nvChart.yAxis2, nvChart.y2Axis], function (axis) {
    if (axis) axis.tickFormat(d3.format('d'));
  });
  nvChart.margin({left: 40, right: 30, bottom: 20, top: 20});

  _.bindAll(nvChart);
  return nvChart;
};

Telegraph.prototype.update = function() {
  var self = this;

  this.fetchData(function(data) {
    if (self.chart == 'table') {
      self.table.items = self.tableItems(data);
      self.table.update();
      self.addTableDropdown(data);
    } else {
      self.svg.datum(data);
      self.updateChart();
    }
  });
};

Telegraph.prototype.updateChart = function() {
  if (this.nvChart) this.nvChart.update();
};

Telegraph.prototype.fetchData = function() {
  var self = this;

  var data = [];
  var count = 0;

  var targets = _.mapcat(_.compact(this.targets), function (target, targetNum) {
    return _.mapcat(self.vars, function(vars, varNum) {
      return {
        source:    self.subVariables(target.source, vars),
        query:     self.subVariables(target.query, vars) + (vars._transform || ""),
        label:     self.subVariables(target.label, vars),
        shift:     self.subVariables(target.shift, vars),
        targetNum: targetNum,
        varNum:    varNum,
        index:     count++,
        base:      target,
      };
    });
  });

  var promises = [];
  _.each(_.groupBy(targets, function(t) { return [t.source, t.shift] }), function(targets) {
    promises.push(self.getData(data, targets));
  });

  return $.when.apply($, promises).then(function() {
    return data;
  });
};

Telegraph.defaultPeriod = "15m";

Telegraph.prototype.getData = function(data, targets) {
  if (targets.length == 0) return;

  var opts = {
    from:     this.from,
    until:    this.until,
    period:   this.period || Telegraph.defaultPeriod,
    align:    this.chart == 'table' ? 'start' : this.align,
    shift:    targets[0].shift,
    timezone: - (new Date()).getTimezoneOffset() + "m",
  };

  var url = Telegraph.baseUrls[targets[0].source] + "?" + _.compact(_.map(targets, function(t, i) {
    return "target=" + encodeURIComponent(t.query);
  })).join('&');

  return $.ajax({
    url: url,
    data: opts
  }).done(function(results) {
    _.each(results, function(val, i) {
      var datapoints = _.map(val.datapoints, function(d) {
        return { x: d[1] || 0, y: d[0] || 0 }
      });
      var target = targets[i];
      var item = data[target.targetNum] || {
        bar:     target.base.type == 'bar',
        type:    target.base.type,
        yAxis:   target.base.axis == 'right' ? 2 : 1,
        results: [],
      };
      if (target.varNum == 0) {
        item.key    = target.label;
        item.values = datapoints;
      }
      item.results[target.varNum] = datapoints;
      data[target.targetNum] = item;
    });
  });
};

Telegraph.prototype.save = function(opts) {
  if (this.id) {
    var self = this;
    var data = {
      hash:      this.hash,
      chart:     this.chart,
      from:      this.from,
      until:     this.until,
      period:    this.period,
      align:     this.align,
      invert:    this.invert,
      sumCols:   this.sumCols,
      sumRows:   this.sumRows,
      refresh:   this.refresh,
      targets:   this.targets,
      variables: this.variables,
      force:     opts.force
    };

    return this.http('put', data).done(function(results) {
      self.hash = results.hash;
    });
  }
};

Telegraph.prototype.rename = function(id) {
  var self = this;
  return this.http('patch', {id: id}).done(function() {
    self.id = id;
  });
};

Telegraph.prototype.delete = function(opts) {
  var self = this;
  return this.http('delete', opts);
};

Telegraph.load = function(name, overrides) {
  return Telegraph.http('get', ['graphs', name]).then(function (results) {
    if (results) {
      console.log(results)
      return new Telegraph(_.extend(results, overrides));
    }
  });
};

Telegraph.list = function(process) {
  Telegraph.http('get', ['graphs']).done(function(results) {
    process(results);
  });
};

Telegraph.dashboard = function (graphs) {
  this.graphs = graphs;
};

Telegraph.dashboard.prototype.draw = function (selector, css) {
  $(selector).empty();
  _.each(this.graphs, function(graph, i) {
    var id = "dashboard-" + i;
    $(selector).append($("<div/>", {id: id, css: css || {}}));
    Telegraph.load(graph.id, graph.overrides).then(function(telegraph) {
      telegraph.draw("#" + id);
    });
  });
};