'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDebounce } from 'use-debounce'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Statistic = {
  type: string
  count: number
}

interface AutoCompleteProps {
  value?: string
  onChange?: (value: string) => void
  onSearch?: (value: string) => void
  tenantSlug?: string
  className?: string
  placeholder?: string
}

export default function SearchAutocomplete({ 
  value = '', 
  onChange,
  onSearch,
  tenantSlug,
  className,
  placeholder = "Search documents..."
}: AutoCompleteProps) {
  const router = useRouter()
  const [query, setQuery] = useState(value)
  const [debouncedQuery] = useDebounce(query, 300)
  const [statistics, setStatistics] = useState<Statistic[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isLoading, setIsLoading] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [total, setTotal] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchStatisticsCallback = useCallback(async (q: string) => {
    if (q.trim() === '' || q.length < 2) {
      setStatistics([])
      setTotal(0)
      return
    }

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        q: q,
        ...(tenantSlug && { tenant: tenantSlug }),
      })

      const response = await fetch(`/api/search/autocomplete?${params}`)
      if (response.ok) {
        const data = await response.json()
        setStatistics(data.statistics || [])
        setTotal(data.total || 0)
      } else {
        setStatistics([])
        setTotal(0)
      }
    } catch (error) {
      console.error('Error fetching autocomplete:', error)
      setStatistics([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [tenantSlug])

  useEffect(() => {
    if (debouncedQuery && isFocused) {
      fetchStatisticsCallback(debouncedQuery)
    } else {
      setStatistics([])
      setTotal(0)
    }
  }, [debouncedQuery, fetchStatisticsCallback, isFocused])

  useEffect(() => {
    setQuery(value)
  }, [value])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setQuery(newValue)
    onChange?.(newValue)
    setSelectedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev < statistics.length - 1 ? prev + 1 : prev,
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (query.trim()) {
        handleSearch()
      }
    } else if (e.key === 'Escape') {
      setStatistics([])
      setSelectedIndex(-1)
    }
  }

  const handleSearch = () => {
    if (query.trim()) {
      if (onSearch) {
        onSearch(query)
      } else {
        const params = new URLSearchParams({
          q: query,
          ...(tenantSlug && { tenant: tenantSlug }),
        })
        router.push(`/dashboard/search?${params}`)
      }
      setStatistics([])
      setSelectedIndex(-1)
    }
  }

  const handleFocus = () => {
    setIsFocused(true)
    if (query.trim() && query.length >= 2) {
      fetchStatisticsCallback(query)
    }
  }

  const handleBlur = () => {
    // Delay hiding suggestions to allow for click events
    setTimeout(() => {
      setIsFocused(false)
      setStatistics([])
      setSelectedIndex(-1)
    }, 200)
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="pl-10 pr-20"
          aria-label="Search input"
          aria-autocomplete="list"
          aria-controls="statistics-list"
          aria-expanded={statistics.length > 0}
        />
        <Button
          size="sm"
          onClick={handleSearch}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-8"
          disabled={!query.trim() || isLoading}
          aria-label="Search"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Search'
          )}
        </Button>
      </div>
      {isLoading && isFocused && debouncedQuery.length >= 2 && (
        <div
          className="mt-2 p-2 bg-background border rounded-md shadow-sm absolute z-50 w-full"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        </div>
      )}
      {statistics.length > 0 && !isLoading && isFocused && (
        <ul
          id="statistics-list"
          className="mt-2 bg-background border rounded-md shadow-sm absolute z-50 w-full max-h-96 overflow-auto"
          role="listbox"
        >
          {total > 0 && (
            <li className="px-4 py-2 border-b bg-muted/50">
              <div className="text-sm font-medium">
                {total} document{total !== 1 ? 's' : ''} found
              </div>
            </li>
          )}
          {statistics.map((stat, index) => (
            <li
              key={stat.type}
              className={cn(
                "px-4 py-3 cursor-default transition-colors",
                index === selectedIndex && 'bg-muted'
              )}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{stat.type}</div>
                <div className="text-sm text-muted-foreground">{stat.count}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
