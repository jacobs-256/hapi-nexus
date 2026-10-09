import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { encodeBase64 } from '@/lib/utils'
import FilesPage from './files'

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    fileSearch: vi.fn(),
    sessionActive: true,
    search: {
        tab: 'directories' as const,
        query: '感',
    },
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mocks.navigate,
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => mocks.search,
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} }),
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => vi.fn(),
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: {
            id: 'session-1',
            active: mocks.sessionActive,
            metadata: { path: '/workspace/project' },
        },
    }),
}))

vi.mock('@/hooks/queries/useGitStatusFiles', () => ({
    useGitStatusFiles: () => ({
        status: null,
        error: null,
        isLoading: false,
        refetch: vi.fn(),
    }),
}))

vi.mock('@/hooks/queries/useSessionFileSearch', () => ({
    useSessionFileSearch: (...args: unknown[]) => {
        mocks.fileSearch(...args)
        return {
            files: [{
                fileName: '感言.ts',
                filePath: 'src',
                fullPath: 'src/感言.ts',
                fileType: 'file' as const,
            }],
            error: null,
            isLoading: false,
            refetch: vi.fn(),
        }
    },
}))

vi.mock('@/components/SessionHeader', () => ({
    SessionHeader: () => null,
}))

vi.mock('@/components/SessionFiles/DirectoryTree', () => ({
    DirectoryTree: () => <div data-testid="directory-tree" />,
}))

function renderFilesPage() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    })

    const page = () => (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <FilesPage />
            </I18nProvider>
        </QueryClientProvider>
    )
    const view = render(page())
    return { ...view, rerenderPage: () => view.rerender(page()) }
}

describe('FilesPage search navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.sessionActive = true
        mocks.search.query = '感'
        window.localStorage.clear()
        window.sessionStorage.clear()
    })

    it('waits for an inactive session to reopen before mounting directory queries', () => {
        mocks.sessionActive = false
        mocks.search.query = ''
        const view = renderFilesPage()

        expect(screen.queryByTestId('directory-tree')).not.toBeInTheDocument()
        expect(screen.getByText('This session is inactive. Reopen it to browse files.')).toBeInTheDocument()

        mocks.sessionActive = true
        view.rerenderPage()

        expect(screen.getByTestId('directory-tree')).toBeInTheDocument()
        expect(screen.queryByText('This session is inactive. Reopen it to browse files.')).not.toBeInTheDocument()
    })

    it('restores the route query and carries it through file navigation', () => {
        renderFilesPage()

        const input = screen.getByRole('textbox')
        expect(input).toHaveValue('感')
        expect(mocks.fileSearch).toHaveBeenCalledWith(
            expect.anything(),
            'session-1',
            '感',
            { enabled: true },
        )

        fireEvent.click(screen.getByRole('button', { name: /感言\.ts/ }))
        expect(mocks.navigate).toHaveBeenCalledWith({
            to: '/sessions/$sessionId/file',
            params: { sessionId: 'session-1' },
            search: {
                path: encodeBase64('src/感言.ts'),
                tab: 'directories',
                query: '感',
            },
        })

        fireEvent.change(input, { target: { value: '言' } })
        expect(mocks.navigate).toHaveBeenLastCalledWith({
            to: '/sessions/$sessionId/files',
            params: { sessionId: 'session-1' },
            search: {
                tab: 'directories',
                query: '言',
            },
            replace: true,
        })

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
        expect(mocks.navigate).toHaveBeenLastCalledWith({
            to: '/sessions/$sessionId/files',
            params: { sessionId: 'session-1' },
            search: { tab: 'directories' },
            replace: true,
        })
    })
})
