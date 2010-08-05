/**
 * Pie chart.
 *
 * Simple example:
 *
 *   var pie = new PieChart({percent: 0.31});
 *   pie.draw(document.getElementById('canvas').getContext("2d"));
 *
 * Animated example ("progress pie"):
 *
 *   var pie = new PieChart({
 *     g: document.getElementById('canvas').getContext("2d")
 *   });
 *   var timer = setInterval(function(){
 *     if (!pie.drawUnlessComplete()) {
 *       clearInterval(timer);
 *     } else {
 *       pie.percent += 0.01;
 *     }
 *   }, 50);
 *   ...
 *   <canvas id="canvas" width="16" height="16"></canvas>
 */
function PieChart(options){
  for (var k in options) this[k] = options[k];
}
PieChart.prototype.border = 1;
PieChart.prototype.width = 16;
PieChart.prototype.height = 16;
PieChart.prototype.origin = {x:0, y:0};
PieChart.prototype.percent = 0.0;
PieChart.prototype.foreground = "rgb(218, 122, 168)";
PieChart.prototype.background = "rgb(255, 220, 240)";

PieChart.prototype.draw = function(g) {
  var w2 = this.width / 2,
      h2 = this.height / 2,
      originX = this.origin.x || w2,
      originY = this.origin.y || h2,
      r = Math.floor(Math.max(this.width, this.height) / 2) - this.border,
      _clearNext;

  if (!g) g = this.g;

  if (this._clearRect) {
    // this is #1 performance eater, but is needed
    g.clearRect.apply(g, this._clearRect);
  }

  if (this.border || this.background) {
    g.beginPath();
    g.arc(originX, originY, r, 0, Math.PI * 2, false);
    g.closePath();
    if (this.border) {
      g.lineWidth = this.border;
      g.strokeStyle = this.foreground;
    }
    if (this.background) {
      g.fillStyle = this.background;
      g.fill();
    }
    if (this.border) {
      // this is #2 performance eater
      g.stroke();
    }
  }

  var startangle = -Math.PI / 2;
  var endangle = startangle + (this.percent * Math.PI * 2);

  g.beginPath();
  g.moveTo(originX, originY);
  g.arc(originX, originY, r, startangle, endangle, false);
  g.closePath();

  g.fillStyle = this.foreground;
  g.fill();

  // clear the rect we just drew on next draw (e.g. if the size shrunk)
  this._clearRect = [originX-w2, originY-h2, this.width, this.height];
};

PieChart.prototype.drawUnlessComplete = function(g) {
  if (this.percent >= 1.0) {
    if (this.percent > 1.0) {
      this.percent = 1.0;
      this.draw(g);
    }
    return false;
  } else {
    this.draw(g);
    return true;
  }
};

exports.parent.PieChart = PieChart;
