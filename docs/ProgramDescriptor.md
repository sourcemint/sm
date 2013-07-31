Program Descriptor
==================

A `sm` compatible program must have a *program descriptor* stored in a `program.json` file at the root of the package.

The following declarations are recognized:

	program.json ~ {
	    "config": {
	    	"<uid>/<selector>": <object>
	    }
	}

After booting a program with `sm run`, the program may store runtime information at `.rt`.
If there is a file at `.rt/program.rt.json` it will be merged on top of `program.json` at boot time. This file is used to keep runtime configuration information that may override defaults set in `program.json`.


Notes
=====

  * `$__DIRNAME` is replaced with the absolute realpath to the directory representing the root of the package.
