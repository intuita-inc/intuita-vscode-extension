import { configureStore, Dispatch, Reducer } from '@reduxjs/toolkit';
import { persistReducer, persistStore } from 'redux-persist';
import MementoStorage from './storage';

import rootReducer, { actions, getInitialState } from './slice';
import { Memento } from 'vscode';
import { PersistPartial } from 'redux-persist/es/persistReducer';
import { persistedStateCodecNew } from '../persistedState/codecs';

const buildStore = (workspaceState: Memento) => {
	const persistedReducer = persistReducer(
		{
			key: 'root',
			storage: new MementoStorage(workspaceState),
			throttle: 1000,
		},
		rootReducer,
	);

	const validatedReducer: Reducer<
		(RootState & PersistPartial) | undefined
	> = (state, action) => {
		if (action.type === 'persist/REHYDRATE') {
			const decoded = persistedStateCodecNew.decode(action.payload);

			const validatedPayload =
				decoded._tag === 'Right' ? decoded.right : getInitialState();

			return persistedReducer(state, {
				...action,
				payload: validatedPayload,
			});
		}

		return persistedReducer(state, action);
	};

	const store = configureStore({
		reducer: validatedReducer,
	});

	const persistor = persistStore(store);

	return { store, persistor };
};

type RootState = ReturnType<typeof rootReducer>;
type ActionCreators = typeof actions;
type Actions = { [K in keyof ActionCreators]: ReturnType<ActionCreators[K]> };
type Action = Actions[keyof Actions];

type AppDispatch = Dispatch<Action>;
type Store = ReturnType<typeof buildStore>['store'];

export { buildStore };

export type { RootState, AppDispatch, Store };
