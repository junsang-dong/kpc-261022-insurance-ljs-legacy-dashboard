#!/bin/ksh
# SYNTHETIC FIXTURE - NOT FOR BUILD
# AIX 기동 스크립트 예시
JAVA_HOME=/usr/IBMJava/jre
export JAVA_HOME

oslevel -s
lsattr -El sys0 -a realmem
errpt | head -20
topas -n 1

$JAVA_HOME/bin/java $(cat /app/conf/jvm-options.txt) -jar /app/legacy-board.war
