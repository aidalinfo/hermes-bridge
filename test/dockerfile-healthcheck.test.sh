#!/bin/sh
set -eu
grep -Fq 'HEALTHCHECK' Dockerfile
grep -Fq "fetch('http://127.0.0.1:8787/health')" Dockerfile
