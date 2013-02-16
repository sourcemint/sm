#!/bin/bash

# Find the dirname path to the fully resolved command in order to locate entry point for sm codebase.
# @credit http://stackoverflow.com/a/246128/330439
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
BASE_PATH="$( cd -P "$( dirname "$SOURCE" )" && pwd )"


sm build --dir "$BASE_PATH/.."
if [ $? -ne 0 ] ; then
  exit 1
fi

sm publish --dir "$BASE_PATH/../dist/sm"
if [ $? -ne 0 ] ; then
  exit 1
fi

#sm publish --dir "$BASE_PATH/../dist/npm"
#if [ $? -ne 0 ] ; then
#  exit 1
#fi
