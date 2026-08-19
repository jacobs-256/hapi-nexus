# Elasticsearch 对话存储模板

**语言：** [English](../../en/storage/elasticsearch.md) | 简体中文

在 **Settings -> Storage** 中选择 Elasticsearch 后，它就是对话历史的直接运行时数据库。HAPI 的 Elasticsearch 对话存储使用 append-only 文档模型，兼容普通 index 和 data stream。

- 必须包含 `@timestamp`，data stream 写入依赖该字段。
- 写入使用 `_bulk` 的 `create` action。
- 逻辑表通过 `table` 区分：`messages`、`message_epochs`、`message_counters`。
- `message_counters` 保存每个会话的 `max_seq`，用于避免读取/写入时扫描整个会话历史。

下面示例使用索引名/数据流名 `hapi-conversations-1`。

## 创建 data stream template

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

## 创建 data stream

```bash
curl -X PUT "$ELASTICSEARCH_URL/_data_stream/hapi-conversations-1" \
  -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY"
```

然后在 **Settings -> Storage** 中配置：

- URL：`$ELASTICSEARCH_URL`
- Index：`hapi-conversations-1`
- API Key：base64 后的 API key 值

## 最小权限

API key 至少需要目标 data stream/index 的：

- `create_doc`
- `read`
- `view_index_metadata`

如果需要让 HAPI 自动创建普通 index，还需要 `create_index` 或 `manage`。使用 data stream 时建议提前手动创建 template/data stream，不给运行时 key 创建索引权限。
