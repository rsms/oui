#!/bin/sh
cd `dirname "$0"`
# --force, -f  Force rebuild.
# --help, -h   Full list of options.
../../oui/build -o public $@ client
