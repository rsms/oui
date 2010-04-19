// Command Line Client utilities.

exports.isTerminal = 'TERM' in process.env;
exports.isColorTerminal = exports.isTerminal && 
  (process.env.TERM.indexOf('color') !== -1 || 'CLICOLOR' in process.env)

if (exports.isColorTerminal) {
  const styles = {
    // not related to color
    'bold'      : ['1',    '22'],
    'italic'    : ['3',    '23'], // not widely supported. Sometimes treated as inverse
    'underline' : ['4',    '24'], // single
    'blink'     : ['5',    '25'], // blink slow
    'blinkfast' : ['6',    '25'], // blink fast
    'inverse'   : ['7',    '27'], // swap foreground and background
    'strike'    : ['9',    '29'], // single
    
    // foreground color [30-37]
    'black'     : ['30',   '39'],
    'grey'      : ['1;30', '0;39'],
    'red'       : ['1;31', '0;39'],
    'green'     : ['1;32', '0;39'],
    'yellow'    : ['1;33', '0;39'],
    'blue'      : ['1;34', '0;39'],
    'purple'    : ['1;35', '0;39'],
    'cyan'      : ['1;36', '0;39'],
    'white'     : ['1;37', '0;39'],
    'fg:reset'  : ['0;39'],
    
    // background color [40-47]
    'bg:black'  : ['40', '49'],
    'bg:red'    : ['41', '49'],
    'bg:green'  : ['42', '49'],
    'bg:yellow' : ['43', '49'],
    'bg:blue'   : ['44', '49'],
    'bg:purple' : ['45', '49'],
    'bg:cyan'   : ['46', '49'],
    'bg:white'  : ['47', '49'],
    'bg:reset'  : ['49'],
  };
  exports.style = function(str, style) {
    var s, r, onlyFirst;
    if (style === undefined) {
      style = str;
      onlyFirst = true;
    }
    s = styles[style]; if (!s) return str;
    r = '\033[' + s[0] + 'm';
    if (!onlyFirst) r += str + '\033[' + s[1] + 'm';
    return r;
  }
} else {
  exports.style = function(str) { return str; }
}
