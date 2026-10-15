FROM public.ecr.aws/docker/library/postgres:17@sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgaudit=17.1-2.pgdg13+1 \
  && rm -rf /var/lib/apt/lists/* \
  && test -f /usr/share/postgresql/17/extension/pgaudit.control

# Disposable recovery environment only. Keep both source extensions available;
# restore failures must not log SQL or row values through the server's logger.
CMD ["postgres", "-c", "shared_preload_libraries=pg_stat_statements,pgaudit", "-c", "pgaudit.log=none", "-c", "log_statement=none", "-c", "log_min_messages=panic", "-c", "log_min_error_statement=panic"]
