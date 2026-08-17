import { useAssistantState } from '@assistant-ui/react'
import { formatDateTimeAttribute, formatMessageTimestamp, formatMessageTimestampTitle } from '@/chat/presentation'
import { cn } from '@/lib/utils'

type MessageTimestampProps = {
    className?: string
}

export function MessageTimestamp(props: MessageTimestampProps) {
    const createdAt = useAssistantState(({ message }) => message.createdAt)
    const dateTime = formatDateTimeAttribute(createdAt)
    const title = formatMessageTimestampTitle(createdAt) || undefined

    return (
        <time
            dateTime={dateTime}
            title={title}
            className={cn('tabular-nums', props.className)}
        >
            {formatMessageTimestamp(createdAt)}
        </time>
    )
}
