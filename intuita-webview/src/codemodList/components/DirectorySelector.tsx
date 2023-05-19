import { useEffect, useState } from 'react';
import {
	VSCodeButton,
	VSCodeTextField,
} from '@vscode/webview-ui-toolkit/react';
import { KeyboardEvent } from 'react';

const getAutocompleteValue = (
	currentValue: string,
	autocompleteItems: string[],
	index: number = 0,
) => {
	const autocompleteItem = autocompleteItems[index];

	if (autocompleteItem === undefined) {
		return null;
	}

	const currAddedDir =
		currentValue.indexOf('/') !== -1
			? currentValue.substring(0, currentValue.lastIndexOf('/') + 1)
			: '';

	return `${currAddedDir}${autocompleteItem}`;
};

type Props = {
	defaultValue: string;
	error: { value: string; timestamp: number } | null;
	autocompleteItems: string[];
	onEditDone: (value: string) => void;
	onChange: (value: string) => void;
};
export const DirectorySelector = ({
	defaultValue,
	onEditDone,
	onChange,
	error,
	autocompleteItems,
}: Props) => {
	const [value, setValue] = useState(defaultValue);
	const [showError, setShowError] = useState(error);
	const [autocompleteIndex, setAutocompleteIndex] = useState<number>(0);

	console.log(autocompleteIndex, autocompleteItems, 'test');
	// currently always 0, in future switch items with Tab;
	const autocompleteContent = getAutocompleteValue(
		value,
		autocompleteItems,
		autocompleteIndex,
	);

	useEffect(() => {
		setShowError(error);
	}, [error]);

	const handleChange = (e: Event | React.FormEvent<HTMLElement>) => {
		setShowError(null);
		const value = (e.target as HTMLInputElement).value;
		setValue(value);
		onChange(value);
		setAutocompleteIndex(0);
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if(e.key === 'Tab') {
			e.preventDefault();
			const nextAutocompleteIndex = (autocompleteIndex + 1) % autocompleteItems.length;
			setValue((prevValue) =>  getAutocompleteValue(prevValue, autocompleteItems, nextAutocompleteIndex) ?? prevValue);
			setAutocompleteIndex(nextAutocompleteIndex);
		}
	}

	return (
		<div className="flex flex-row justify-between pb-10">
			<div className="flex flex-col w-full">
				{autocompleteContent ? (
					<span className="autocomplete">{autocompleteContent}</span>
				) : null}
				<VSCodeTextField
					className="flex-1"
					value={value}
					onInput={handleChange}
					onKeyDown={handleKeyDown}
				/>

				{showError && (
					<span className="text-error">{showError.value}</span>
				)}
			</div>
			<div
				className="cursor-pointer ml-3"
				onClick={() => onEditDone(value)}
			>
				<VSCodeButton>Update</VSCodeButton>
			</div>
		</div>
	);
};
