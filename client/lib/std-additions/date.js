Date.distantFuture = new Date((new Date()).getTime()+9000000000000);
Date.distantPast = new Date(0);
Date.timezoneOffset = 0; // Standard offset in milliseconds
Date.timezoneDSTOffset = 0; // DST offset in milliseconds

// timestamp should be in milliseconds since the epoch, UTC
Date.fromUTCTimestamp = function(timestamp) {
  timestamp = parseInt(timestamp);
  if (isNaN(timestamp))
    throw new Error('Date.fromUTCTimestamp failed to parse integer argument');
  return new Date(timestamp+Date.timezoneOffset);
};

Date.currentUTCTimestamp = function() {
  return (new Date()).toUTCTimestamp();
};

Date.recalculateOffsets = function() {
  var rightNow = new Date(),
      date1 = new Date(rightNow.getFullYear(), 0, 1, 0, 0, 0, 0),
      date2 = new Date(rightNow.getFullYear(), 6, 1, 0, 0, 0, 0),
      temp = date1.toGMTString(),
      date3 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1)),
      date4;
  temp = date2.toGMTString();
  date4 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1));
  // standard offset, not counting DST
  Date.timezoneOffset = (date3 - date1);
  // offset including DST
  Date.timezoneDSTOffset = (date4 - date2);
};

// calculate timezone offset at load-time
Date.recalculateOffsets();
