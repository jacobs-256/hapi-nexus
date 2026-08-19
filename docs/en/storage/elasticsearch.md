# Elasticsearch Conversation Storage Template

**Language:** English | [简体中文](../../zh-CN/storage/elasticsearch.md)

When selected in **Settings -> Storage**, Elasticsearch is the direct runtime database for conversation history. HAPI stores conversations as append-only documents, compatible with both regular indices and data streams.

- `@timestamp` is required for data-stream writes.
- Writes use `_bulk` `create` actions.
- Logical tables are separated by `table`: `messages`, `message_epochs`, and `message_counters`.
- `message_counters` stores per-session `max_seq` so reads and writes do not need to scan a full conversation history.

The examples below use `hapi-conversations-1` as the index/data-stream name.

## Create the data-stream template

```bash
curl -X PUT "$ELASTICSEARCH_URL/_index_template/hapi-conversations-template" \
  -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "index_patterns": ["hapi-conversations-*"],
  "data_stream": {},
  "priority": 500,
  "template": {
    "settings": {
      "index.mapping.total_fields.limit": 3000
    },
    "mappings": {
      "dynamic": true,
      "properties": {
        "@timestamp": { "type": "date" },
        "table": { "type": "keyword" },
        "row_key": { "type": "keyword" },
        "op": { "type": "keyword" },
        "version_at": { "type": "date", "format": "epoch_millis" },
        "row": {
          "properties": {
            "id": { "type": "keyword" },
            "session_id": { "type": "keyword" },
            "local_id": { "type": "keyword" },
            "content": { "type": "text", "index": false },
            "created_at": { "type": "long" },
            "seq": { "type": "long" },
            "invoked_at": { "type": "long" },
            "scheduled_at": { "type": "long" },
            "epoch": { "type": "long" },
            "max_seq": { "type": "long" }
          }
        },
        "id": { "type": "keyword" },
        "session_id": { "type": "keyword" },
        "local_id": { "type": "keyword" },
        "content": { "type": "text", "index": false },
        "created_at": { "type": "long" },
        "seq": { "type": "long" },
        "invoked_at": { "type": "long" },
        "scheduled_at": { "type": "long" },
        "epoch": { "type": "long" },
        "max_seq": { "type": "long" }
      }
    }
  }
}
JSON
```

## Create the data stream

```bash
curl -X PUT "$ELASTICSEARCH_URL/_data_stream/hapi-conversations-1" \
  -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY"
```

Then configure **Settings -> Storage**:

- URL: `$ELASTICSEARCH_URL`
- Index: `hapi-conversations-1`
- API Key: the base64 API key value

## Minimum privileges

The API key needs at least these privileges on the target data stream/index:

- `create_doc`
- `read`
- `view_index_metadata`

If HAPI should create a regular index automatically, also grant `create_index` or `manage`. For data streams, prefer creating the template/data stream manually and keep the runtime key scoped to read/write only.
