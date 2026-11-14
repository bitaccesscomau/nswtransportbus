const number = new Intl.NumberFormat('en-AU');

export function formatNumber(value: number | null | undefined): string {
	return number.format(value ?? 0);
}

export function formatBytes(value: number | null | undefined): string {
	if (!value) return '—';
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / 1_048_576).toFixed(1)} MB`;
}
