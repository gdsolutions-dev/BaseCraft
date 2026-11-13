SELECT Commandes.Client, Sum(Commandes.Montant) AS SommeDeMontant, Count(Commandes.N°) AS CompteDeN°
FROM Commandes
GROUP BY Commandes.Client;
