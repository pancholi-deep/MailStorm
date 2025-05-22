import React, { useEffect, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/EmailForm';
import { AuthContext } from './AuthContext'; // Make sure this path is correct

const App = () => {
  const { user, setUser } = useContext(AuthContext);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser && !user) {
      setUser(JSON.parse(storedUser));
    }
  }, [user, setUser]);

  return (
    <Routes>
      <Route 
        path="/" 
        element={<Navigate to="/login" />} 
      />
      <Route
        path="/login"
        element={!user ? <Login setUser={setUser} /> : <Navigate to="/dashboard" />}
      />
      <Route
        path="/dashboard"
        element={user ? <Dashboard user={user} setUser={setUser} /> : <Navigate to="/" />}
      />
    </Routes>
  );
};

export default App;

